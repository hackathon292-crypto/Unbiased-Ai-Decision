"""
Quantum — Unbiased AI Decision Platform
main.py  —  Phase 4: Security & Privacy

Phase 4 additions
-----------------
1. Custom Pydantic validation error handler — returns ValidationErrorResponse
   (never raw input values or stack traces).
2. Request security middleware — body-size limit, null-byte scan,
   Content-Type enforcement on prediction routes, security response headers.
3. PII-masked logging via utils/pii.py applied at every log write point.
4. utils/validation.py — all schemas live there; routers import from it.
5. Version 4.0.0.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
import uuid
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from hiring.router    import router as hiring_router
from loan.router      import router as loan_router
from social.router    import router as social_router
from utils.shap_cache import router as shap_router
from utils.logger     import setup_logger, log_correlation_event
from utils.model_registry import registry
from utils.database   import ensure_indexes
from utils.validation import (
    ValidationErrorResponse, ValidationErrorDetail, SecurityErrorResponse, RateLimitResponse
)

import hiring.model_loader as hiring_loader
import loan.model_loader   as loan_loader
import social.model_loader as social_loader

logger = setup_logger("main")

_RUNNING_TESTS = ("pytest" in sys.modules) or bool(os.getenv("PYTEST_CURRENT_TEST"))
if not _RUNNING_TESTS:
    load_dotenv(dotenv_path=Path(__file__).resolve().parent / ".env", override=False)
MONGO_URL = os.getenv("MONGO_URL")

def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name, str(default))
    try:
        return int(raw)
    except ValueError:
        logger.warning(f"Invalid int for {name}='{raw}', using default={default}")
        return default


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name, str(default))
    try:
        return float(raw)
    except ValueError:
        logger.warning(f"Invalid float for {name}='{raw}', using default={default}")
        return default


MAX_BODY_BYTES: int = _env_int("MAX_BODY_BYTES", 64 * 1024)
REQUEST_TIMEOUT_S: float = _env_float("REQUEST_TIMEOUT_S", 15.0)
RATE_LIMIT_WINDOW_S: int = _env_int("RATE_LIMIT_WINDOW_S", 60)
RATE_LIMIT_MAX_REQUESTS: int = _env_int("RATE_LIMIT_MAX_REQUESTS", 120)
RATE_LIMIT_MAX_KEYS: int = _env_int("RATE_LIMIT_MAX_KEYS", 10_000)
RATE_LIMIT_CLEANUP_INTERVAL: int = _env_int("RATE_LIMIT_CLEANUP_INTERVAL", 200)
RATE_LIMIT_PATHS = frozenset({"/hiring/predict", "/loan/predict", "/social/recommend"})

_SENSITIVE_KEYS = frozenset({
    "gender", "religion", "ethnicity", "race",
    "age_group", "location", "language", "disability",
})
_PREDICTION_PATHS = frozenset({"/hiring/predict", "/loan/predict", "/social/recommend"})


def _parse_frontend_origins() -> list[str]:
    raw = os.getenv("FRONTEND_ORIGINS", "").strip()
    if raw:
        return [origin.strip() for origin in raw.split(",") if origin.strip()]
    return [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ]


_FRONTEND_ORIGINS = _parse_frontend_origins()
_rate_limiter_store: dict[str, deque[float]] = defaultdict(deque)
_rate_limiter_lock = asyncio.Lock()
_rate_limiter_ops = 0


# ─── Lifespan ─────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("=== Quantum startup (Phase 4) ===")
    try:
        hiring_loader.preload()
        loan_loader.preload()
        social_loader.preload()
    except FileNotFoundError as exc:
        logger.error(f"FATAL: {exc}  Run python create_dummy_models.py")
        raise
    if not MONGO_URL and not _RUNNING_TESTS:
        logger.warning(
            "MONGO_URL not set — persistence will use the JSON fallback "
            "(predictions.json). This is OK for demos but NOT recommended for "
            "production traffic. Set MONGO_URL in the Render dashboard to "
            "enable MongoDB-backed auditing."
        )
    await ensure_indexes()
    logger.info("=== Ready ===")
    yield
    logger.info("=== Shutdown ===")


# ─── App ──────────────────────────────────────────────────────────────────────

app = FastAPI(
    title       = "Quantum – Unbiased AI Decision Platform",
    description = (
        "Fairness-aware AI backend — Phase 4 hardened: strict Pydantic v2 "
        "validation with injection guards, PII-masked append-only audit logs, "
        "body-size limits, and structured error responses."
    ),
    version     = "4.0.0",
    docs_url    = "/docs",
    redoc_url   = "/redoc",
    lifespan    = lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_FRONTEND_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)


# ─── Custom error handlers ────────────────────────────────────────────────────

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """
    Replace FastAPI's default 422 body with ValidationErrorResponse.
    Never exposes raw input values — only field name + human-readable message.
    """
    correlation_id = getattr(request.state, "correlation_id", None)
    details: List[ValidationErrorDetail] = []
    for error in exc.errors():
        field = ".".join(
            str(part) for part in error.get("loc", ()) if part != "body"
        )
        details.append(ValidationErrorDetail(
            field   = field or "unknown",
            message = error.get("msg", "Invalid value"),
            input   = None,   # never echo raw input back
        ))
    logger.warning(
        f"[{correlation_id}] Validation error on {request.url.path}: "
        f"{len(details)} field(s) failed"
    )
    return JSONResponse(
        status_code = 422,
        content     = {
            **ValidationErrorResponse(
                error=          "Validation failed",
                correlation_id= correlation_id,
                details=        details,
            ).model_dump(),
            "code": "VALIDATION_ERROR",
        },
    )


@app.exception_handler(ValidationError)
async def pydantic_handler(request: Request, exc: ValidationError):
    correlation_id = getattr(request.state, "correlation_id", None)
    return JSONResponse(
        status_code = 422,
        content     = {
            **ValidationErrorResponse(
                error=          "Data validation error",
                correlation_id= correlation_id,
                details=        [ValidationErrorDetail(field="unknown", message=str(exc))],
            ).model_dump(),
            "code": "VALIDATION_ERROR",
        },
    )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    correlation_id = getattr(request.state, "correlation_id", "unknown")
    logger.error(f"[{correlation_id}] Unhandled on {request.url.path}: {exc}")
    return JSONResponse(
        status_code = 500,
        content     = {
            "error":          "Internal server error",
            "code":           "INTERNAL_ERROR",
            "correlation_id": correlation_id,
            # No 'detail' key — never leak exception messages to clients
        },
    )


# ─── Security middleware (outermost — registered last) ────────────────────────

@app.middleware("http")
async def timeout_middleware(request: Request, call_next):
    try:
        return await asyncio.wait_for(call_next(request), timeout=REQUEST_TIMEOUT_S)
    except asyncio.TimeoutError:
        correlation_id = getattr(request.state, "correlation_id", None)
        logger.warning(
            f"[timeout] Request timed out path={request.url.path} "
            f"after={REQUEST_TIMEOUT_S}s corr={correlation_id}"
        )
        return JSONResponse(
            status_code=504,
            content={
                "error": "Request timed out",
                "code": "REQUEST_TIMEOUT",
                "correlation_id": correlation_id,
            },
        )


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    global _rate_limiter_ops
    if request.url.path in RATE_LIMIT_PATHS:
        client_ip = request.client.host if request.client else "unknown"
        key = f"{client_ip}:{request.url.path}"
        now = time.monotonic()
        async with _rate_limiter_lock:
            _rate_limiter_ops += 1
            if RATE_LIMIT_CLEANUP_INTERVAL > 0 and _rate_limiter_ops % RATE_LIMIT_CLEANUP_INTERVAL == 0:
                _cleanup_rate_limiter_store(now)
            bucket = _rate_limiter_store[key]
            cutoff = now - RATE_LIMIT_WINDOW_S
            while bucket and bucket[0] < cutoff:
                bucket.popleft()
            if len(bucket) >= RATE_LIMIT_MAX_REQUESTS:
                retry_after = max(1, int(RATE_LIMIT_WINDOW_S - (now - bucket[0])))
                correlation_id = getattr(request.state, "correlation_id", None)
                payload = RateLimitResponse(
                    error="Rate limit exceeded",
                    retry_after_s=retry_after,
                    correlation_id=correlation_id,
                ).model_dump()
                payload["code"] = "RATE_LIMITED"
                response = JSONResponse(status_code=429, content=payload)
                response.headers["Retry-After"] = str(retry_after)
                return response
            bucket.append(now)
    return await call_next(request)


@app.middleware("http")
async def request_security_middleware(request: Request, call_next):
    """
    Guards (short-circuit on first failure):
    1. Content-Length pre-check → 413 if over MAX_BODY_BYTES.
    2. Body size + null-byte scan.
    3. Content-Type enforcement on prediction endpoints → 415.
    Then adds security response headers to every response.
    """
    path   = request.url.path
    method = request.method

    # 1. Content-Length header pre-check
    cl = request.headers.get("content-length")
    if cl:
        try:
            if int(cl) > MAX_BODY_BYTES:
                logger.warning(f"[security] Oversized Content-Length={cl} path={path}")
                return JSONResponse(
                    status_code = 413,
                    content = {
                        **SecurityErrorResponse(
                        reason=f"Request body exceeds {MAX_BODY_BYTES} bytes."
                        ).model_dump(),
                        "code": "PAYLOAD_TOO_LARGE",
                    },
                )
        except ValueError:
            pass

    if method in ("POST", "PUT", "PATCH"):
        body_bytes = await request.body()

        # 2a. Actual body size
        if len(body_bytes) > MAX_BODY_BYTES:
            logger.warning(f"[security] Oversized body {len(body_bytes)}B path={path}")
            return JSONResponse(
                status_code = 413,
                content = {
                    **SecurityErrorResponse(
                    reason=f"Request body exceeds {MAX_BODY_BYTES} bytes."
                    ).model_dump(),
                    "code": "PAYLOAD_TOO_LARGE",
                },
            )

        # 2b. Null-byte injection
        if b"\x00" in body_bytes:
            logger.warning(f"[security] Null-byte injection attempt path={path}")
            return JSONResponse(
                status_code = 400,
                content = {
                    **SecurityErrorResponse(
                    reason="Request body contains disallowed characters."
                    ).model_dump(),
                    "code": "DISALLOWED_BODY_CHARACTERS",
                },
            )

        # 3. Content-Type on prediction routes
        if path in _PREDICTION_PATHS:
            ct = request.headers.get("content-type", "")
            if "application/json" not in ct.lower():
                logger.warning(f"[security] Non-JSON Content-Type='{ct}' path={path}")
                return JSONResponse(
                    status_code = 415,
                    content = {
                        **SecurityErrorResponse(
                        reason="Content-Type must be 'application/json'."
                        ).model_dump(),
                        "code": "UNSUPPORTED_CONTENT_TYPE",
                    },
                )

    response = await call_next(request)

    # Security response headers
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"]        = "DENY"
    response.headers["Referrer-Policy"]        = "strict-origin-when-cross-origin"

    return response


# ─── Correlation middleware (inner layer) ─────────────────────────────────────

@app.middleware("http")
async def correlation_middleware(request: Request, call_next):
    start_ms = time.monotonic()
    method   = request.method

    body_bytes: bytes = await request.body()
    raw_payload: Optional[dict] = None
    if body_bytes:
        try:
            raw_payload = json.loads(body_bytes)
        except (json.JSONDecodeError, UnicodeDecodeError):
            pass

    correlation_id    = str(uuid.uuid4())
    path              = request.url.path
    method            = request.method
    domain            = _path_to_domain(path)
    model_meta        = registry.get_metadata(domain) if domain else {}
    sanitised_payload = _sanitise(raw_payload)

    if path not in ("/health", "/", "/docs", "/redoc", "/openapi.json"):
        log_correlation_event(
            correlation_id = correlation_id,
            event          = "request_received",
            path           = path,
            method         = method,
            payload        = sanitised_payload,
            model_metadata = model_meta,
            result         = None,
        )

    request.state.correlation_id = correlation_id
    request.state.domain         = domain

    response   = await call_next(request)
    elapsed_ms = round((time.monotonic() - start_ms) * 1000, 2)
    response.headers["X-Correlation-ID"] = correlation_id
    response.headers["X-Response-Time"]  = f"{elapsed_ms}ms"

    logger.info(
        f"{method} {path} → {response.status_code} "
        f"[{elapsed_ms}ms] corr={correlation_id[:8]}…"
    )
    return response


# ─── Routers ─────────────────────────────────────────────────────────────────

app.include_router(hiring_router, prefix="/hiring", tags=["Hiring"])
app.include_router(loan_router,   prefix="/loan",   tags=["Loan"])
app.include_router(social_router, prefix="/social", tags=["Social"])
app.include_router(shap_router,                     tags=["SHAP"])


# ─── Platform endpoints ───────────────────────────────────────────────────────

@app.get("/", tags=["Platform"])
def root():
    return {
        "status":   "online",
        "platform": "Quantum – Unbiased AI Decision Platform",
        "version":  "4.0.0",
        "security": {
            "pii_masking":      os.getenv("PII_MASK_ENABLED", "true"),
            "input_validation": "strict Pydantic v2 + injection guards",
            "body_size_limit":  f"{MAX_BODY_BYTES // 1024} KB",
            "response_headers": "nosniff, deny-framing, referrer-policy",
        },
        "endpoints": [
            "POST /hiring/predict",
            "POST /loan/predict",
            "POST /social/recommend",
            "GET  /shap/{correlation_id}",
            "WS   /shap/ws/{correlation_id}",
            "GET  /models",
            "GET  /health",
            "GET  /docs",
        ],
    }


@app.get("/health", tags=["Platform"])
def health_check():
    from utils.shap_cache import shap_cache, ws_manager
    audit_path = Path("logs/audit.jsonl")
    return {
        "status":    "healthy",
        "timestamp": time.time(),
        "version":   "4.0.0",
        "models":    registry.list_models(),
        "audit_log": {
            "path":       str(audit_path),
            "exists":     audit_path.exists(),
            "size_bytes": audit_path.stat().st_size if audit_path.exists() else 0,
        },
        "shap_cache": {
            "backend":        "redis+memory" if shap_cache._redis else "memory-only",
            "ws_connections": ws_manager.connected_count(),
        },
        "security": {
            "pii_masking":    os.getenv("PII_MASK_ENABLED", "true"),
            "max_body_bytes": MAX_BODY_BYTES,
        },
    }


@app.get("/models", tags=["Platform"])
def list_models():
    return {"models": registry.list_models(), "timestamp": time.time()}


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _path_to_domain(path: str) -> Optional[str]:
    if path.startswith("/hiring"): return "hiring"
    if path.startswith("/loan"):   return "loan"
    if path.startswith("/social"): return "social"
    return None


def _sanitise(payload: Optional[dict]) -> Optional[dict]:
    if payload is None:
        return None
    return {k: v for k, v in payload.items() if k not in _SENSITIVE_KEYS}


def _cleanup_rate_limiter_store(now: float) -> None:
    """
    Keep in-memory limiter bounded for long-lived processes.
    1) Drop keys with fully expired buckets.
    2) If still above max, drop oldest-active keys first.
    """
    cutoff = now - RATE_LIMIT_WINDOW_S
    empty_keys: list[str] = []
    for k, bucket in _rate_limiter_store.items():
        while bucket and bucket[0] < cutoff:
            bucket.popleft()
        if not bucket:
            empty_keys.append(k)
    for k in empty_keys:
        _rate_limiter_store.pop(k, None)

    if len(_rate_limiter_store) <= RATE_LIMIT_MAX_KEYS:
        return

    overflow = len(_rate_limiter_store) - RATE_LIMIT_MAX_KEYS
    oldest_active = sorted(
        ((k, bucket[-1]) for k, bucket in _rate_limiter_store.items() if bucket),
        key=lambda item: item[1],
    )
    for k, _ in oldest_active[:overflow]:
        _rate_limiter_store.pop(k, None)
