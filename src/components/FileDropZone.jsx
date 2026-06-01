import { useRef, useState } from 'react';

export default function FileDropZone({ onFiles }) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef(null);

  const openPicker = () => {
    inputRef.current?.click();
  };

  const handleFiles = (files) => {
    if (files?.length) {
      onFiles(files);
    }
  };

  return (
    <div
      className={`fade-panel rounded-[20px] border border-dashed p-6 text-center transition ${
        isDragging
          ? 'border-[#0071e3] bg-[#0071e3]/10'
          : 'border-white/18 bg-void-surface hover:border-white/28'
      }`}
      onClick={openPicker}
      onDragEnter={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        setIsDragging(false);
      }}
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        handleFiles(event.dataTransfer.files);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openPicker();
        }
      }}
      role="button"
      tabIndex={0}
    >
      <input
        className="hidden"
        multiple
        onChange={(event) => {
          handleFiles(event.target.files);
          event.target.value = '';
        }}
        ref={inputRef}
        type="file"
      />
      <p className="text-base font-semibold text-white">Drop files here</p>
      <p className="mt-1 text-sm text-void-muted">or click to browse</p>
    </div>
  );
}
