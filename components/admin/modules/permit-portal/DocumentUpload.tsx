import React, { useRef, useState } from 'react';
import { Upload, File, X, CheckCircle, AlertCircle } from 'lucide-react';

interface UploadedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  uploadedAt: string;
  status: 'uploading' | 'success' | 'error';
}

interface DocumentUploadProps {
  maxFiles?: number;
  maxFileSize?: number; // i MB
  acceptedTypes?: string[];
}

const DocumentUpload: React.FC<DocumentUploadProps> = ({
  maxFiles = 5,
  maxFileSize = 10,
  acceptedTypes = ['.pdf', '.doc', '.docx', '.xlsx', '.xls', '.jpg', '.png'],
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const validateFile = (file: File): string | null => {
    const fileSizeMB = file.size / (1024 * 1024);
    if (fileSizeMB > maxFileSize) {
      return `Filen är för stor (max ${maxFileSize}MB)`;
    }

    const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!acceptedTypes.includes(fileExtension)) {
      return `Filtyp ${fileExtension} är inte tillåten`;
    }

    return null;
  };

  const handleFiles = (fileList: FileList) => {
    setError(null);

    if (files.length >= maxFiles) {
      setError(`Maximal antal filer är ${maxFiles}`);
      return;
    }

    const newFiles: UploadedFile[] = [];

    Array.from(fileList).forEach((file) => {
      const validationError = validateFile(file);

      if (validationError) {
        setError(validationError);
        return;
      }

      const uploadedFile: UploadedFile = {
        id: Math.random().toString(36).substr(2, 9),
        name: file.name,
        size: file.size,
        type: file.type,
        uploadedAt: new Date().toLocaleString('sv-SE'),
        status: 'uploading',
      };

      newFiles.push(uploadedFile);

      // Simulera upload
      setTimeout(
        () => {
          setFiles((prev) =>
            prev.map((f) => (f.id === uploadedFile.id ? { ...f, status: 'success' as const } : f)),
          );
        },
        1000 + Math.random() * 1000,
      );
    });

    setFiles((prev) => [...prev, ...newFiles]);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  return (
    <div className="document-upload">
      <div
        className={`document-upload-dropzone ${dragActive ? 'active' : ''}`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={acceptedTypes.join(',')}
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
          className="document-upload-input"
          aria-label="Ladda upp dokument"
        />

        <div className="document-upload-content">
          <Upload size={48} color="#005293" />
          <p className="document-upload-title">Dra och släpp dokument här</p>
          <p className="document-upload-subtitle">eller klicka för att välja från datorn</p>
          <button type="button" className="document-upload-btn" onClick={() => fileInputRef.current?.click()}>
            Välj filer
          </button>
          <p className="document-upload-info">
            Max {maxFiles} filer, {maxFileSize}MB per fil. Tillåtna format: {acceptedTypes.join(', ')}
          </p>
        </div>
      </div>

      {error && (
        <div className="document-upload-error" role="alert">
          <AlertCircle size={20} />
          <span>{error}</span>
        </div>
      )}

      {files.length > 0 && (
        <div className="document-upload-list">
          <h3 className="document-upload-list-title">
            Uppladdade dokument ({files.length}/{maxFiles})
          </h3>
          <ul className="document-upload-files" role="list">
            {files.map((file) => (
              <li key={file.id} className="document-upload-file">
                <File size={20} color="#005293" />
                <div className="document-upload-file-info">
                  <p className="document-upload-file-name">{file.name}</p>
                  <p className="document-upload-file-meta">
                    {formatFileSize(file.size)} • {file.uploadedAt}
                  </p>
                </div>

                {file.status === 'uploading' && (
                  <div className="document-upload-progress">
                    <div className="document-upload-spinner" />
                  </div>
                )}

                {file.status === 'success' && <CheckCircle size={20} color="#2E8B57" />}

                <button
                  type="button"
                  className="document-upload-remove"
                  onClick={() => removeFile(file.id)}
                  aria-label={`Ta bort ${file.name}`}
                >
                  <X size={20} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default DocumentUpload;
