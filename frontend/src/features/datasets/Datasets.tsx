import { useState, useEffect, useCallback, type DragEvent, type ChangeEvent } from 'react';
import { 
  Upload, Database, Trash2, AlertCircle, X, FileText, 
  Image as ImageIcon, FileSpreadsheet, FileArchive, FileCode, File as FileIcon,
  Loader2, Search, Download, Grid, List as ListIcon,
  RefreshCw, HardDrive, Plus
} from 'lucide-react';
import { api } from '../../lib/api';
import type { FileMetadata, FileStats, DatasetAnalysisResult } from '../../lib/api';

type ViewMode = 'grid' | 'list';
type FileCategory = 'all' | 'image' | 'document' | 'data' | 'archive' | 'other';

const FILE_ICONS: Record<string, typeof FileIcon> = {
  image: ImageIcon,
  document: FileText,
  data: FileSpreadsheet,
  archive: FileArchive,
  other: FileCode,
};

const CATEGORY_COLORS: Record<string, string> = {
  image: 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300',
  document: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  data: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  archive: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  other: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
};

// Allowed file extensions for display
const ALLOWED_TYPES = [
  // Images
  '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.tiff', '.ico',
  // Documents
  '.pdf', '.doc', '.docx', '.txt', '.rtf', '.odt',
  // Spreadsheets
  '.csv', '.xls', '.xlsx', '.ods',
  // Data formats
  '.json', '.parquet', '.xml', '.yaml', '.yml',
  // Archives
  '.zip', '.tar', '.gz', '.bz2',
  // Code/Text
  '.py', '.js', '.ts', '.html', '.css', '.md', '.log',
];

export function Datasets() {
  // Upload states
  const [dragActive, setDragActive] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<Map<string, { name: string; progress: number }>>(new Map());
  
  // File list states
  const [files, setFiles] = useState<FileMetadata[]>([]);
  const [fileStats, setFileStats] = useState<FileStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [activeCategory, setActiveCategory] = useState<FileCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFile, setSelectedFile] = useState<FileMetadata | null>(null);
  
  // Upload form states
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [domain, setDomain] = useState<'loan' | 'hiring' | 'social' | ''>('');
  
  // Analysis states
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<DatasetAnalysisResult | null>(null);

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, statsRes] = await Promise.all([
        api.listFiles({ category: activeCategory === 'all' ? undefined : activeCategory, limit: 100 }),
        api.getFileStats(),
      ]);
      setFiles(listRes.files);
      setFileStats(statsRes);
    } catch (err) {
      console.error('Failed to fetch files:', err);
    } finally {
      setLoading(false);
    }
  }, [activeCategory]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const handleDrag = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = async (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const droppedFiles = Array.from<File>(e.dataTransfer.files);
    await uploadMultipleFiles(droppedFiles);
  };

  const handleFileSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = Array.from<File>(e.target.files);
      await uploadMultipleFiles(selectedFiles);
    }
  };

  const uploadMultipleFiles = async (filesToUpload: File[]) => {
    const uploadPromises = filesToUpload.map(async (file) => {
      const uploadId = `${file.name}-${Date.now()}`;
      
      // Add to uploading map
      setUploadingFiles(prev => new Map(prev).set(uploadId, { name: file.name, progress: 0 }));

      try {
        const formData = new FormData();
        formData.append('file', file);
        if (description) formData.append('description', description);
        if (tags) formData.append('tags', tags);
        if (domain) formData.append('domain', domain);

        const response = await api.uploadFile(formData);
        
        // Remove from uploading map
        setUploadingFiles(prev => {
          const next = new Map(prev);
          next.delete(uploadId);
          return next;
        });

        return response.file;
      } catch (err) {
        // Remove from uploading map on error
        setUploadingFiles(prev => {
          const next = new Map(prev);
          next.delete(uploadId);
          return next;
        });
        throw err;
      }
    });

    try {
      const uploadedFiles = await Promise.all(uploadPromises);
      // Refresh file list
      fetchFiles();
      // Clear form
      setDescription('');
      setTags('');
      
      // Auto-analyze data files (CSV, Excel, JSON, Parquet)
      const dataFiles = uploadedFiles.filter(f => f.category === 'data');
      if (dataFiles.length > 0) {
        await handleAnalyze(dataFiles[0].id);
      }
    } catch (err) {
      alert('Some files failed to upload. Please try again.');
    }
  };

  const handleDelete = async (fileId: string) => {
    if (!confirm('Are you sure you want to delete this file?')) return;
    
    try {
      await api.deleteFile(fileId);
      setFiles(prev => prev.filter(f => f.id !== fileId));
      if (selectedFile?.id === fileId) setSelectedFile(null);
    } catch (err) {
      alert('Failed to delete file');
    }
  };

  const handleDownload = (file: FileMetadata) => {
    const url = api.downloadFile(file.id);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.filename;
    a.click();
  };

  const handleAnalyze = async (fileId: string) => {
    setAnalyzing(true);
    try {
      const result = await api.analyzeDataset(fileId);
      setAnalysisResult(result);
    } catch (err) {
      alert('Analysis failed: ' + (err as Error).message);
    } finally {
      setAnalyzing(false);
    }
  };

  const filteredFiles = files.filter(file => 
    file.filename.toLowerCase().includes(searchQuery.toLowerCase()) ||
    file.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const FileIconComponent = (category: string) => {
    const Icon = FILE_ICONS[category] || FileIcon;
    return <Icon size={24} />;
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-semibold dark:text-white flex items-center gap-3">
            <Database className="text-emerald-600" size={32} />
            File Manager
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400 mt-1">
            Upload images, PDFs, documents, datasets, and any file type
          </p>
        </div>
        {fileStats && (
          <div className="text-right">
            <div className="text-sm text-zinc-500 dark:text-zinc-400">Storage Used</div>
            <div className="text-2xl font-semibold dark:text-white">{fileStats.total_size_human}</div>
            <div className="text-sm text-zinc-500">{fileStats.total_files} files</div>
          </div>
        )}
      </div>

      {/* Stats Cards */}
      {fileStats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {Object.entries(fileStats.by_category).map(([category, count]) => (
            <button
              key={category}
              onClick={() => setActiveCategory(category as FileCategory)}
              className={`p-4 rounded-2xl border-2 transition-all duration-300 text-left hover:shadow-md hover:-translate-y-0.5 ${
                activeCategory === category
                  ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950 shadow-md'
                  : 'border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800'
              }`}
            >
              <div className={`inline-flex p-2 rounded-xl ${CATEGORY_COLORS[category]}`}>
                {FileIconComponent(category)}
              </div>
              <div className="mt-2 text-2xl font-semibold dark:text-white">{count}</div>
              <div className="text-sm text-zinc-500">{category}</div>
              <div className="text-sm text-zinc-500 capitalize">{category}s</div>
            </button>
          ))}
        </div>
      )}

      {/* Upload Zone */}
      <div
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-3xl p-8 transition-all ${
          dragActive
            ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950'
            : 'border-zinc-300 dark:border-zinc-700 hover:border-emerald-500'
        }`}
      >
        <div className="text-center">
          <Upload className={`mx-auto mb-4 ${dragActive ? 'text-emerald-600' : 'text-zinc-400'}`} size={48} />
          <h3 className="text-xl font-medium dark:text-white">
            {dragActive ? 'Drop files here' : 'Drag & drop any files'}
          </h3>
          <p className="text-zinc-500 mt-2">
            Images, PDFs, Word docs, Excel, CSV, JSON, ZIP, and more
          </p>
          
          {/* Upload Options */}
          <div className="mt-6 max-w-md mx-auto space-y-3">
            <input
              type="text"
              placeholder="Description (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-2 text-sm dark:text-white"
            />
            <input
              type="text"
              placeholder="Tags (comma separated)"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              className="w-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-2 text-sm dark:text-white"
            />
            <select
              value={domain}
              onChange={(e) => setDomain(e.target.value as any)}
              className="w-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-2 text-sm dark:text-white"
            >
              <option value="">Select domain (optional)</option>
              <option value="loan">Loan Approval</option>
              <option value="hiring">Hiring Decision</option>
              <option value="social">Social Recommendation</option>
            </select>
          </div>

          <label className="mt-6 inline-flex items-center gap-2 px-8 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl cursor-pointer transition-all duration-300 hover:scale-105 hover:shadow-lg hover:shadow-emerald-500/30">
            <Plus size={20} />
            Select Files to Upload
            <input
              type="file"
              className="hidden"
              multiple
              accept={ALLOWED_TYPES.join(',')}
              onChange={handleFileSelect}
            />
          </label>
          
          <p className="text-xs text-zinc-400 mt-3">
            Max file size: {fileStats?.max_file_size_mb || 100}MB per file
          </p>
        </div>

        {/* Uploading Progress */}
        {uploadingFiles.size > 0 && (
          <div className="mt-6 space-y-2">
            {Array.from(uploadingFiles.entries()).map(([id, { name }]) => (
              <div key={id} className="flex items-center gap-3 bg-white dark:bg-zinc-800 rounded-xl p-3">
                <Loader2 className="animate-spin text-emerald-600" size={20} />
                <span className="flex-1 text-sm dark:text-white truncate">{name}</span>
                <span className="text-sm text-zinc-500">Uploading...</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Filters & Search */}
      <div className="flex flex-wrap gap-4 items-center">
        <div className="flex-1 min-w-[200px] relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={20} />
          <input
            type="text"
            placeholder="Search files by name or tags..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl dark:text-white"
          />
        </div>
        
        <div className="flex gap-2">
          {(['all', 'image', 'document', 'data', 'archive'] as FileCategory[]).map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 hover:scale-105 ${
                activeCategory === cat
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
              }`}
            >
              {cat === 'all' ? 'All Files' : cat.charAt(0).toUpperCase() + cat.slice(1) + 's'}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setViewMode('grid')}
            className={`p-2 rounded-xl transition-all duration-200 hover:scale-110 ${viewMode === 'grid' ? 'bg-emerald-600 text-white shadow-md' : 'bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700'}`}
          >
            <Grid size={20} />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-2 rounded-xl transition-all duration-200 hover:scale-110 ${viewMode === 'list' ? 'bg-emerald-600 text-white shadow-md' : 'bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700'}`}
          >
            <ListIcon size={20} />
          </button>
          <button
            onClick={fetchFiles}
            className="p-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-all duration-200 hover:scale-110 hover:rotate-180"
          >
            <RefreshCw size={20} />
          </button>
        </div>
      </div>

      {analyzing && (
        <div className="flex items-center gap-3 bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 rounded-2xl p-4">
          <Loader2 className="animate-spin text-emerald-600" size={20} />
          <p className="text-sm text-emerald-700 dark:text-emerald-300">
            Analyzing uploaded dataset and generating insights...
          </p>
        </div>
      )}

      {/* File List */}
      {loading ? (
        <div className="text-center py-12">
          <Loader2 className="animate-spin mx-auto text-emerald-600 mb-4" size={48} />
          <p className="text-zinc-500">Loading files...</p>
        </div>
      ) : filteredFiles.length === 0 ? (
        <div className="text-center py-12 bg-zinc-50 dark:bg-zinc-900 rounded-3xl">
          <HardDrive className="mx-auto text-zinc-300 dark:text-zinc-700 mb-4" size={64} />
          <h3 className="text-xl font-semibold dark:text-white mb-2">No files yet</h3>
          <p className="text-zinc-500">Upload your first file to get started</p>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filteredFiles.map(file => (
            <div
              key={file.id}
              onClick={() => setSelectedFile(file)}
              className="group bg-white dark:bg-zinc-900 rounded-2xl p-4 border border-zinc-200 dark:border-zinc-800 hover:border-emerald-500 cursor-pointer transition-all duration-300 hover:shadow-lg hover:shadow-emerald-500/10 hover:-translate-y-1"
            >
              {/* Preview */}
              <div className="aspect-square rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mb-3 overflow-hidden">
                {file.category === 'image' ? (
                  <img
                    src={api.previewFile(file.id)}
                    alt={file.filename}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = '';
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <div className={`p-4 rounded-xl ${CATEGORY_COLORS[file.category]}`}>
                    {FileIconComponent(file.category)}
                  </div>
                )}
              </div>
              
              {/* Info */}
              <div className="space-y-1">
                <p className="font-medium text-sm dark:text-white truncate" title={file.filename}>
                  {file.filename}
                </p>
                <p className="text-xs text-zinc-500">{file.size_human}</p>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${CATEGORY_COLORS[file.category]}`}>
                    {file.category}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          <table className="w-full">
            <thead className="bg-zinc-50 dark:bg-zinc-800">
              <tr>
                <th className="text-left py-4 px-6 text-sm font-medium text-zinc-600 dark:text-zinc-400">File</th>
                <th className="text-left py-4 px-4 text-sm font-medium text-zinc-600 dark:text-zinc-400">Category</th>
                <th className="text-left py-4 px-4 text-sm font-medium text-zinc-600 dark:text-zinc-400">Size</th>
                <th className="text-left py-4 px-4 text-sm font-medium text-zinc-600 dark:text-zinc-400">Uploaded</th>
                <th className="text-right py-4 px-6 text-sm font-medium text-zinc-600 dark:text-zinc-400">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredFiles.map(file => (
                <tr key={file.id} className="border-t dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors duration-200">
                  <td className="py-4 px-6">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${CATEGORY_COLORS[file.category]}`}>
                        {FileIconComponent(file.category)}
                      </div>
                      <div>
                        <p className="font-medium dark:text-white">{file.filename}</p>
                        {file.description && (
                          <p className="text-sm text-zinc-500">{file.description}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="py-4 px-4">
                    <span className={`text-xs px-2 py-1 rounded-full ${CATEGORY_COLORS[file.category]}`}>
                      {file.category}
                    </span>
                  </td>
                  <td className="py-4 px-4 dark:text-white">{file.size_human}</td>
                  <td className="py-4 px-4 text-sm text-zinc-500">
                    {new Date(file.uploaded_at).toLocaleDateString()}
                  </td>
                  <td className="py-4 px-6">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => handleDownload(file)}
                        className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-700 rounded-lg text-zinc-600 transition-all duration-200 hover:scale-110"
                        title="Download"
                      >
                        <Download size={18} />
                      </button>
                      <button
                        onClick={() => handleDelete(file.id)}
                        className="p-2 hover:bg-red-50 dark:hover:bg-red-950 rounded-lg text-red-600 transition-all duration-200 hover:scale-110"
                        title="Delete"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Analysis Result Modal */}
      {analysisResult && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
          onClick={() => setAnalysisResult(null)}
        >
          <div
            className="bg-white dark:bg-zinc-900 rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b dark:border-zinc-800 flex justify-between items-center">
              <h2 className="text-xl font-semibold dark:text-white flex items-center gap-2">
                <FileSpreadsheet className="text-emerald-600" size={24} />
                Dataset Analysis Results
              </h2>
              <button
                onClick={() => setAnalysisResult(null)}
                className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-all duration-200 hover:scale-110"
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 space-y-6">
              {analysisResult.success ? (
                <>

                  {/* Domain Detection */}
                  <div className="bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 rounded-2xl p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-emerald-700 dark:text-emerald-300 mb-1">Detected Domain</p>
                        <p className="text-2xl font-bold text-emerald-800 dark:text-emerald-200 capitalize">
                          {analysisResult.detected_domain}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-emerald-700 dark:text-emerald-300 mb-1">Confidence</p>
                        <p className="text-2xl font-bold text-emerald-800 dark:text-emerald-200">
                          {(analysisResult.confidence * 100).toFixed(0)}%
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Summary Stats */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-zinc-50 dark:bg-zinc-800 rounded-xl p-4">
                      <p className="text-sm text-zinc-500 mb-1">Rows Processed</p>
                      <p className="text-2xl font-semibold dark:text-white">{analysisResult.rows_predicted}</p>
                      <p className="text-xs text-zinc-400">of {analysisResult.rows_total} total</p>
                    </div>
                    <div className="bg-zinc-50 dark:bg-zinc-800 rounded-xl p-4">
                      <p className="text-sm text-zinc-500 mb-1">Approval Rate</p>
                      <p className="text-2xl font-semibold dark:text-white">
                        {((analysisResult.summary?.approval_rate || 0) * 100).toFixed(0)}%
                      </p>
                    </div>
                    <div className="bg-zinc-50 dark:bg-zinc-800 rounded-xl p-4">
                      <p className="text-sm text-zinc-500 mb-1">Avg Confidence</p>
                      <p className="text-2xl font-semibold dark:text-white">
                        {((analysisResult.summary?.avg_confidence || 0) * 100).toFixed(0)}%
                      </p>
                    </div>
                    <div className="bg-zinc-50 dark:bg-zinc-800 rounded-xl p-4">
                      <p className="text-sm text-zinc-500 mb-1">Flagged</p>
                      <p className="text-2xl font-semibold dark:text-white">
                        {analysisResult.summary?.flagged_for_review || 0}
                      </p>
                      <p className="text-xs text-zinc-400">high bias risk</p>
                    </div>
                  </div>

                  {/* Column Mapping */}
                  {analysisResult.column_mapping && (
                    <div>
                      <h3 className="font-semibold dark:text-white mb-3">Column Mapping</h3>
                      <div className="bg-zinc-50 dark:bg-zinc-800 rounded-xl p-4 space-y-2">
                        {Object.entries(analysisResult.column_mapping).map(([field, col]) => (
                          <div key={field} className="flex justify-between text-sm">
                            <span className="text-zinc-500">{field}</span>
                            <span className="font-medium dark:text-white">→ {col}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Errors */}
                  {analysisResult.errors && analysisResult.errors.length > 0 && (
                    <div>
                      <h3 className="font-semibold dark:text-white mb-3">Errors ({analysisResult.errors.length})</h3>
                      <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-xl p-4 max-h-40 overflow-auto">
                        {analysisResult.errors.slice(0, 5).map((err, i) => (
                          <p key={i} className="text-sm text-red-700 dark:text-red-300 mb-1">
                            Row {err.row}: {err.message}
                          </p>
                        ))}
                        {analysisResult.errors.length > 5 && (
                          <p className="text-sm text-red-600 dark:text-red-400">
                            ... and {analysisResult.errors.length - 5} more
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Unmapped Columns */}
                  {analysisResult.unmapped_columns && analysisResult.unmapped_columns.length > 0 && (
                    <div>
                      <h3 className="font-semibold dark:text-white mb-3">Unmapped Required Fields</h3>
                      <div className="flex flex-wrap gap-2">
                        {analysisResult.unmapped_columns.map((field, i) => (
                          <span key={i} className="text-sm px-3 py-1 bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200 rounded-full">
                            {field}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-xl p-6">
                  <AlertCircle className="text-red-600 mb-3" size={32} />
                  <h3 className="font-semibold text-red-800 dark:text-red-200 mb-2">Analysis Failed</h3>
                  <p className="text-red-700 dark:text-red-300">{analysisResult.error || 'Unknown error'}</p>
                </div>
              )}

              {/* Action */}
              <div className="pt-4 border-t dark:border-zinc-800">
                <button
                  onClick={() => {
                    setAnalysisResult(null);
                    window.location.reload();
                  }}
                  className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-medium transition-all duration-300 hover:scale-105 hover:shadow-lg hover:shadow-emerald-500/30"
                >
                  View Results on Dashboard
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* File Detail Modal */}
      {selectedFile && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
          onClick={() => setSelectedFile(null)}
        >
          <div
            className="bg-white dark:bg-zinc-900 rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b dark:border-zinc-800 flex justify-between items-center">
              <h2 className="text-xl font-semibold dark:text-white">File Details</h2>
              <button
                onClick={() => setSelectedFile(null)}
                className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg"
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="p-6 space-y-6">
              {/* Preview */}
              <div className="aspect-video bg-zinc-100 dark:bg-zinc-800 rounded-2xl flex items-center justify-center overflow-hidden">
                {selectedFile.category === 'image' ? (
                  <img
                    src={api.previewFile(selectedFile.id)}
                    alt={selectedFile.filename}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="text-center">
                    <div className={`inline-flex p-6 rounded-2xl mb-4 ${CATEGORY_COLORS[selectedFile.category]}`}>
                      {FileIconComponent(selectedFile.category)}
                    </div>
                    <p className="text-zinc-500">Preview not available for this file type</p>
                  </div>
                )}
              </div>

              {/* Info Grid */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-zinc-500 mb-1">Filename</p>
                  <p className="font-medium dark:text-white break-all">{selectedFile.filename}</p>
                </div>
                <div>
                  <p className="text-sm text-zinc-500 mb-1">File ID</p>
                  <code className="text-sm bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded">{selectedFile.id}</code>
                </div>
                <div>
                  <p className="text-sm text-zinc-500 mb-1">Type</p>
                  <p className="font-medium dark:text-white">{selectedFile.mime_type}</p>
                </div>
                <div>
                  <p className="text-sm text-zinc-500 mb-1">Category</p>
                  <span className={`text-sm px-2 py-1 rounded-full ${CATEGORY_COLORS[selectedFile.category]}`}>
                    {selectedFile.category}
                  </span>
                </div>
                <div>
                  <p className="text-sm text-zinc-500 mb-1">Size</p>
                  <p className="font-medium dark:text-white">{selectedFile.size_human} ({selectedFile.size_bytes.toLocaleString()} bytes)</p>
                </div>
                <div>
                  <p className="text-sm text-zinc-500 mb-1">Uploaded</p>
                  <p className="font-medium dark:text-white">{new Date(selectedFile.uploaded_at).toLocaleString()}</p>
                </div>
              </div>

              {selectedFile.description && (
                <div>
                  <p className="text-sm text-zinc-500 mb-1">Description</p>
                  <p className="dark:text-white">{selectedFile.description}</p>
                </div>
              )}

              {selectedFile.tags.length > 0 && (
                <div>
                  <p className="text-sm text-zinc-500 mb-2">Tags</p>
                  <div className="flex flex-wrap gap-2">
                    {selectedFile.tags.map((tag, i) => (
                      <span key={i} className="text-sm px-3 py-1 bg-zinc-100 dark:bg-zinc-800 rounded-full dark:text-white">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-4 border-t dark:border-zinc-800">
                <button
                  onClick={() => handleDownload(selectedFile)}
                  className="flex-1 flex items-center justify-center gap-2 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-medium transition-all duration-300 hover:scale-105 hover:shadow-lg hover:shadow-emerald-500/30"
                >
                  <Download size={20} />
                  Download File
                </button>
                <button
                  onClick={() => {
                    handleDelete(selectedFile.id);
                    setSelectedFile(null);
                  }}
                  className="flex-1 flex items-center justify-center gap-2 py-3 bg-red-100 hover:bg-red-200 text-red-700 rounded-2xl font-medium transition-all duration-300 hover:scale-105 hover:shadow-lg hover:shadow-red-500/30"
                >
                  <Trash2 size={20} />
                  Delete File
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tips */}
      <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-3xl p-6">
        <p className="text-sm text-blue-800 dark:text-blue-300">
          Data files (CSV, Excel, JSON, Parquet) are <strong>automatically analyzed</strong> after upload — the system detects the domain, maps columns, and runs batch predictions. Results appear in the Dashboard. Other file types are stored for management only.
        </p>
      </div>

      <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-3xl p-8">
        <div className="flex items-start gap-5">
          <AlertCircle className="text-amber-600 mt-1" size={28} />
          <div>
            <h3 className="font-semibold text-amber-800 dark:text-amber-300">Supported File Types</h3>
            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2 text-sm text-amber-700 dark:text-amber-400">
              <div>• Images (JPG, PNG, GIF, SVG, WebP)</div>
              <div>• Documents (PDF, DOC, DOCX, TXT)</div>
              <div>• Spreadsheets (CSV, XLS, XLSX)</div>
              <div>• Data (JSON, XML, YAML, Parquet)</div>
              <div>• Archives (ZIP, TAR, GZ)</div>
              <div>• Code files (PY, JS, TS, HTML, MD)</div>
              <div>• Max {fileStats?.max_file_size_mb || 100}MB per file</div>
              <div>• All files stored securely</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}