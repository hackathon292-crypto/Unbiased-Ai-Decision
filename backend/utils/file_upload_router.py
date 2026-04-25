"""
file_upload_router.py — Multi-format file upload & management
Supports: Images, PDFs, Docs, CSV, JSON, Parquet, Excel, Text files
"""

from __future__ import annotations

import os
import json
import uuid
from pathlib import Path
from typing import List, Optional
from datetime import datetime, timezone

from fastapi import APIRouter, UploadFile, File, HTTPException, Form, Query, Body
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

# File storage configuration
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "./uploads"))
MAX_FILE_SIZE_MB = int(os.getenv("MAX_FILE_SIZE_MB", "100"))
MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

# Allowed file extensions by category
ALLOWED_EXTENSIONS = {
    # Images
    ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".svg", ".tiff", ".ico",
    # Documents
    ".pdf", ".doc", ".docx", ".txt", ".rtf", ".odt",
    # Spreadsheets
    ".csv", ".xls", ".xlsx", ".ods",
    # Data formats
    ".json", ".parquet", ".xml", ".yaml", ".yml",
    # Model formats
    ".pkl", ".joblib",
    # Archives (optional)
    ".zip", ".tar", ".gz", ".bz2",
    # Code/Text files
    ".py", ".js", ".ts", ".html", ".css", ".md", ".log",
}

# MIME type mapping for preview
MIME_TYPES = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".gif": "image/gif", ".bmp": "image/bmp", ".webp": "image/webp",
    ".svg": "image/svg+xml", ".tiff": "image/tiff", ".ico": "image/x-icon",
    ".pdf": "application/pdf",
    ".txt": "text/plain", ".csv": "text/csv", ".json": "application/json",
    ".xml": "application/xml", ".yaml": "application/yaml", ".yml": "application/yaml",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}

router = APIRouter(prefix="/files", tags=["File Upload"])

# Ensure upload directory exists
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


class FileMetadata(BaseModel):
    id: str = Field(..., description="Unique file ID")
    filename: str = Field(..., description="Original filename")
    stored_name: str = Field(..., description="Stored filename (UUID)")
    size_bytes: int = Field(..., description="File size in bytes")
    size_human: str = Field(..., description="Human-readable size")
    mime_type: str = Field(..., description="Detected MIME type")
    category: str = Field(..., description="File category: image, document, data, archive, other")
    extension: str = Field(..., description="File extension")
    uploaded_at: str = Field(..., description="Upload timestamp ISO format")
    description: Optional[str] = Field(None, description="User-provided description")
    tags: List[str] = Field(default_factory=list, description="User-provided tags")
    domain: Optional[str] = Field(None, description="Associated domain when known")
    role: Optional[str] = Field(None, description="Best-effort role: dataset, model, document, other")


class FileListResponse(BaseModel):
    files: List[FileMetadata]
    total: int
    categories: dict


class FileUploadResponse(BaseModel):
    success: bool
    message: str
    file: FileMetadata


class FileDeleteResponse(BaseModel):
    success: bool
    message: str
    deleted_id: str


class ScanRequest(BaseModel):
    domain: Optional[str] = Field(default=None, pattern=r"^(hiring|loan|social)$")
    file_id: Optional[str] = None
    max_rows: int = Field(default=10000, ge=1, le=50000)


def infer_file_role(filename: str, ext: str) -> str:
    lowered = filename.lower()
    if ext in {".csv", ".xls", ".xlsx", ".ods", ".json", ".parquet"}:
        return "dataset"
    if ext in {".pkl", ".joblib"} or "model" in lowered:
        return "model"
    if ext in {".pdf", ".doc", ".docx", ".txt", ".rtf", ".odt"}:
        return "document"
    return "other"


def get_file_category(ext: str) -> str:
    ext_lower = ext.lower()
    if ext_lower in {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".svg", ".tiff", ".ico"}:
        return "image"
    elif ext_lower in {".pdf", ".doc", ".docx", ".txt", ".rtf", ".odt"}:
        return "document"
    elif ext_lower in {".csv", ".xls", ".xlsx", ".ods", ".json", ".parquet", ".xml", ".yaml", ".yml"}:
        return "data"
    elif ext_lower in {".zip", ".tar", ".gz", ".bz2"}:
        return "archive"
    else:
        return "other"


def human_readable_size(size_bytes: int) -> str:
    for unit in ["B", "KB", "MB", "GB", "TB"]:
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} PB"


def validate_file(file: UploadFile) -> tuple[bool, str]:
    """Validate file extension and size."""
    filename = file.filename or ""
    ext = Path(filename).suffix.lower()
    
    if ext not in ALLOWED_EXTENSIONS:
        allowed_list = ", ".join(sorted(ALLOWED_EXTENSIONS))
        return False, f"File type '{ext}' not allowed. Allowed: {allowed_list}"
    
    # Check file size (read first chunk)
    contents = file.file.read(MAX_FILE_SIZE_BYTES + 1)
    file.file.seek(0)
    
    if len(contents) > MAX_FILE_SIZE_BYTES:
        return False, f"File too large. Max size: {MAX_FILE_SIZE_MB}MB"
    
    return True, ""


@router.post("/upload", response_model=FileUploadResponse)
async def upload_file(
    file: UploadFile = File(..., description="File to upload"),
    description: Optional[str] = Form(None, description="File description"),
    tags: Optional[str] = Form(None, description="Comma-separated tags"),
    domain: Optional[str] = Form(None, description="Associated domain: loan, hiring, social"),
):
    """
    Upload any supported file type (images, PDFs, docs, data files, etc.)
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")
    
    # Validate
    is_valid, error_msg = validate_file(file)
    if not is_valid:
        raise HTTPException(status_code=400, detail=error_msg)
    
    # Generate unique filename
    file_id = str(uuid.uuid4())
    ext = Path(file.filename).suffix.lower()
    stored_name = f"{file_id}{ext}"
    file_path = UPLOAD_DIR / stored_name
    
    # Save file
    try:
        contents = await file.read()
        with open(file_path, "wb") as f:
            f.write(contents)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")
    finally:
        await file.close()
    
    # Build metadata
    size_bytes = len(contents)
    metadata = FileMetadata(
        id=file_id,
        filename=file.filename,
        stored_name=stored_name,
        size_bytes=size_bytes,
        size_human=human_readable_size(size_bytes),
        mime_type=MIME_TYPES.get(ext, "application/octet-stream"),
        category=get_file_category(ext),
        extension=ext,
        uploaded_at=datetime.now(timezone.utc).isoformat(),
        description=description,
        tags=[t.strip() for t in (tags or "").split(",") if t.strip()],
        domain=domain,
        role=infer_file_role(file.filename, ext),
    )
    
    # Save metadata to JSON
    meta_path = UPLOAD_DIR / f"{file_id}.json"
    with open(meta_path, "w") as f:
        import json
        json.dump(metadata.model_dump(), f, indent=2)
    
    return FileUploadResponse(
        success=True,
        message=f"File '{file.filename}' uploaded successfully",
        file=metadata,
    )


@router.get("/list", response_model=FileListResponse)
async def list_files(
    category: Optional[str] = Query(None, description="Filter by category: image, document, data, archive, other"),
    domain: Optional[str] = Query(None, description="Filter by domain"),
    limit: int = Query(100, ge=1, le=1000, description="Max files to return"),
    offset: int = Query(0, ge=0, description="Skip N files"),
):
    """
    List all uploaded files with optional filtering
    """
    files: List[FileMetadata] = []
    
    # Find all metadata files
    meta_files = sorted(UPLOAD_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    
    for meta_path in meta_files:
        try:
            with open(meta_path) as f:
                import json
                data = json.load(f)
                metadata = FileMetadata(**data)
                
                # Apply filters
                if category and metadata.category != category:
                    continue
                if domain and data.get("domain") != domain:
                    continue
                
                files.append(metadata)
        except Exception:
            continue
    
    # Apply pagination
    total = len(files)
    files = files[offset:offset + limit]
    
    # Count by category
    categories = {}
    for f in files:
        categories[f.category] = categories.get(f.category, 0) + 1
    
    return FileListResponse(files=files, total=total, categories=categories)


@router.get("/preview/{file_id}")
async def preview_file(file_id: str):
    """
    Get file preview (images shown directly, others return metadata)
    """
    # Find metadata
    meta_path = UPLOAD_DIR / f"{file_id}.json"
    if not meta_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    
    with open(meta_path) as f:
        import json
        metadata = FileMetadata(**json.load(f))
    
    file_path = UPLOAD_DIR / metadata.stored_name
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File data not found")
    
    # For images, return the actual file
    if metadata.category == "image":
        return FileResponse(
            path=file_path,
            media_type=metadata.mime_type,
            filename=metadata.filename,
        )
    
    # For other files, return metadata with download link
    return JSONResponse(content={
        "preview_available": False,
        "metadata": metadata.model_dump(),
        "download_url": f"/files/download/{file_id}",
        "message": "Preview not available for this file type. Use download link."
    })


@router.get("/download/{file_id}")
async def download_file(file_id: str):
    """
    Download any uploaded file
    """
    # Find metadata
    meta_path = UPLOAD_DIR / f"{file_id}.json"
    if not meta_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    
    with open(meta_path) as f:
        import json
        metadata = FileMetadata(**json.load(f))
    
    file_path = UPLOAD_DIR / metadata.stored_name
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File data not found")
    
    return FileResponse(
        path=file_path,
        media_type=metadata.mime_type,
        filename=metadata.filename,
    )


@router.delete("/delete/{file_id}", response_model=FileDeleteResponse)
async def delete_file(file_id: str):
    """
    Delete an uploaded file and its metadata
    """
    meta_path = UPLOAD_DIR / f"{file_id}.json"
    
    if not meta_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    
    # Load metadata to get stored filename
    with open(meta_path) as f:
        import json
        metadata = FileMetadata(**json.load(f))
    
    file_path = UPLOAD_DIR / metadata.stored_name
    
    # Delete both files
    try:
        if file_path.exists():
            file_path.unlink()
        meta_path.unlink()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete file: {str(e)}")
    
    return FileDeleteResponse(
        success=True,
        message=f"File '{metadata.filename}' deleted successfully",
        deleted_id=file_id,
    )


@router.get("/stats")
async def get_stats():
    """
    Get upload statistics
    """
    meta_files = list(UPLOAD_DIR.glob("*.json"))
    
    total_files = len(meta_files)
    total_size = 0
    by_category = {}
    by_extension = {}
    
    for meta_path in meta_files:
        try:
            with open(meta_path) as f:
                import json
                data = json.load(f)
                total_size += data.get("size_bytes", 0)
                
                cat = data.get("category", "other")
                by_category[cat] = by_category.get(cat, 0) + 1
                
                ext = data.get("extension", "unknown")
                by_extension[ext] = by_extension.get(ext, 0) + 1
        except Exception:
            continue
    
    return {
        "total_files": total_files,
        "total_size_bytes": total_size,
        "total_size_human": human_readable_size(total_size),
        "by_category": by_category,
        "by_extension": by_extension,
        "upload_dir": str(UPLOAD_DIR.absolute()),
        "max_file_size_mb": MAX_FILE_SIZE_MB,
    }


@router.get("/inspect/{file_id}")
async def inspect_file_endpoint(file_id: str):
    """
    Content-aware inspection of any uploaded file.
    Returns schema/preview/stats depending on the file type so the frontend
    can render a clear, human-readable summary without manual setup.
    """
    from .file_inspector import inspect_file

    meta_path = UPLOAD_DIR / f"{file_id}.json"
    if not meta_path.exists():
        raise HTTPException(status_code=404, detail="File not found")

    import json as _json
    with open(meta_path) as f:
        metadata = _json.load(f)

    file_path = UPLOAD_DIR / metadata.get("stored_name", "")
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File data not found")

    try:
        result = inspect_file(file_path, metadata)
        return JSONResponse(content=result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Inspection failed: {str(e)}")


@router.post("/analyze/{file_id}")
async def analyze_file(file_id: str):
    """
    Analyze a tabular data file: detect domain, map columns, run batch predictions.
    Only works for 'data' category files (CSV, Excel, JSON, Parquet).
    """
    from .dataset_analyzer import analyze_uploaded_file
    
    # Check if file exists
    meta_path = UPLOAD_DIR / f"{file_id}.json"
    if not meta_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    
    # Check if it's a data file
    with open(meta_path) as f:
        import json
        metadata = json.load(f)
    
    if metadata.get("category") != "data":
        raise HTTPException(
            status_code=400,
            detail="Only data category files (CSV, Excel, JSON, Parquet) can be analyzed for predictions."
        )
    
    # Run analysis
    try:
        result = await analyze_uploaded_file(file_id, UPLOAD_DIR)
        return JSONResponse(content=result)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")


@router.post("/scan")
async def scan_files(body: ScanRequest = Body(default_factory=ScanRequest)):
    """
    Run the full automated scan pipeline and generate a final report.
    """
    from .dataset_analyzer import (
        analyze_uploaded_file,
        choose_best_model_file,
        detect_domain,
        read_tabular_file,
    )

    meta_files = sorted(UPLOAD_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not meta_files:
        raise HTTPException(status_code=404, detail="No uploaded files available to scan.")

    entries: List[dict] = []
    for meta_path in meta_files:
        try:
            with open(meta_path, "r", encoding="utf-8") as handle:
                entries.append(json.load(handle))
        except Exception:
            continue

    if body.file_id:
        entries = [item for item in entries if item.get("id") == body.file_id]
        if not entries:
            raise HTTPException(status_code=404, detail=f"Uploaded file '{body.file_id}' not found.")

    dataset_files = [item for item in entries if item.get("role") == "dataset" or item.get("category") == "data"]
    model_files = [item for item in entries if item.get("role") == "model" or item.get("extension") in {".pkl", ".joblib"}]
    document_files = [item for item in entries if item.get("category") == "document"]

    if not dataset_files:
        raise HTTPException(
            status_code=400,
            detail="No uploaded dataset found. Upload a CSV, Excel, JSON, Parquet, or ODS file first.",
        )

    selected_dataset: Optional[dict] = None
    selected_domain: Optional[str] = body.domain

    for candidate in dataset_files:
        if body.domain and candidate.get("domain") == body.domain:
            selected_dataset = candidate
            selected_domain = body.domain
            break

        file_path = UPLOAD_DIR / candidate["stored_name"]
        try:
            df = read_tabular_file(file_path, candidate["extension"])
            inferred_domain, _, _ = detect_domain(df)
        except Exception:
            inferred_domain = None

        if body.domain:
            if inferred_domain == body.domain:
                selected_dataset = candidate
                selected_domain = body.domain
                break
        elif inferred_domain:
            selected_dataset = candidate
            selected_domain = inferred_domain
            break

    if selected_dataset is None:
        selected_dataset = dataset_files[0]
        selected_domain = selected_dataset.get("domain") or selected_domain

    analysis = await analyze_uploaded_file(
        file_id=selected_dataset["id"],
        upload_dir=UPLOAD_DIR,
        max_rows=body.max_rows,
        model_file=choose_best_model_file(model_files, selected_domain, UPLOAD_DIR) if selected_domain else None,
    )

    return JSONResponse(
        content={
            "success": bool(analysis.get("success")),
            "dataset": {
                "id": selected_dataset.get("id"),
                "filename": selected_dataset.get("filename"),
                "domain": analysis.get("detected_domain"),
            },
            "model": analysis.get("model"),
            "report": analysis.get("report"),
            "scores": analysis.get("scores"),
            "summary": analysis.get("summary"),
            "validation": analysis.get("validation"),
            "performance": analysis.get("performance"),
            "fairness": analysis.get("fairness"),
            "analysis": analysis,
            "documents_scanned": len(document_files),
            "message": (
                "Scan complete. Final report generated and dashboard data refreshed."
                if analysis.get("success")
                else analysis.get("error", "Scan failed.")
            ),
        }
    )
