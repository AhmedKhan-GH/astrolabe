import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import './PDFViewer.css';

// Set up worker using local legacy worker file
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/legacy/build/pdf.worker.mjs',
  import.meta.url
).toString();

interface OutlineNode {
  title: string;
  dest: any;
  items: OutlineNode[];
}

interface PDFViewerProps {
  pdfUrl?: string;
}

export default function PDFViewer({ pdfUrl }: PDFViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.5);
  const [outline, setOutline] = useState<OutlineNode[]>([]);
  const [showToc, setShowToc] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [fitToPageScale, setFitToPageScale] = useState<number | null>(null);
  const [pageInput, setPageInput] = useState<string>('1');
  const [tocWidth, setTocWidth] = useState<number>(300);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());

  // Update page input when current page changes
  useEffect(() => {
    setPageInput(currentPage.toString());
  }, [currentPage]);

  // Load PDF document
  useEffect(() => {
    if (!pdfUrl) return;

    setLoading(true);
    setError(null);

    const loadPdf = async () => {
      try {
        // Load PDF from blob URL
        const loadingTask = pdfjsLib.getDocument(pdfUrl);
        const pdf = await loadingTask.promise;
        setPdfDoc(pdf);
        setTotalPages(pdf.numPages);
        setCurrentPage(1);

        // Load outline (TOC)
        const pdfOutline = await pdf.getOutline();
        if (pdfOutline) {
          setOutline(pdfOutline);
        }
      } catch (err) {
        setError(`Error loading PDF: ${err instanceof Error ? err.message : 'Unknown error'}`);
        console.error('Error loading PDF:', err);
      } finally {
        setLoading(false);
      }
    };

    loadPdf();
  }, [pdfUrl]);

  // Calculate fit-to-page scale based on first page (only once when PDF loads)
  useEffect(() => {
    if (!pdfDoc || !containerRef.current || fitToPageScale !== null) return;

    const calculateFitScale = async () => {
      try {
        const page: PDFPageProxy = await pdfDoc.getPage(1);
        const viewport = page.getViewport({ scale: 1 });

        const containerHeight = containerRef.current!.clientHeight - 40; // Subtract padding
        const scaleToFit = containerHeight / viewport.height;
        setFitToPageScale(scaleToFit);
        setScale(scaleToFit);
      } catch (err) {
        console.error('Error calculating fit scale:', err);
      }
    };

    calculateFitScale();
  }, [pdfDoc, fitToPageScale]);

  // Render current page
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current || !containerRef.current || !fitToPageScale) return;

    let renderTask: any = null;

    const renderPage = async () => {
      try {
        const page: PDFPageProxy = await pdfDoc.getPage(currentPage);

        // Calculate the target height based on the fit scale and first page
        const firstPage: PDFPageProxy = await pdfDoc.getPage(1);
        const firstPageViewport = firstPage.getViewport({ scale: 1 });
        const targetHeight = firstPageViewport.height * fitToPageScale;

        // Calculate scale for current page to match target height
        const currentPageViewport = page.getViewport({ scale: 1 });
        const pageScale = (targetHeight / currentPageViewport.height) * (scale / fitToPageScale);

        const viewport = page.getViewport({ scale: pageScale });

        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext('2d');
        if (!context) return;

        // Clear canvas before rendering
        context.clearRect(0, 0, canvas.width, canvas.height);

        // Set canvas dimensions to match viewport (maintains aspect ratio)
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        // Use device pixel ratio for crisp rendering
        const outputScale = window.devicePixelRatio || 1;

        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = Math.floor(viewport.width) + 'px';
        canvas.style.height = Math.floor(viewport.height) + 'px';

        const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;

        const renderContext = {
          canvasContext: context,
          viewport: viewport,
          transform: transform as any,
        };

        renderTask = page.render(renderContext);
        await renderTask.promise;
      } catch (err) {
        // Ignore cancellation errors
        if (err instanceof Error && err.message.includes('cancelled')) {
          return;
        }
        console.error('Error rendering page:', err);
        setError(`Error rendering page: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    };

    renderPage();

    // Cleanup function to cancel ongoing render
    return () => {
      if (renderTask) {
        renderTask.cancel();
      }
    };
  }, [pdfDoc, currentPage, scale, fitToPageScale]);

  // Navigate to destination from TOC
  const navigateToDestination = async (dest: any) => {
    if (!pdfDoc) return;

    try {
      let destination = dest;
      if (typeof dest === 'string') {
        destination = await pdfDoc.getDestination(dest);
      }

      if (destination && Array.isArray(destination)) {
        const pageRef = destination[0];
        const pageIndex = await pdfDoc.getPageIndex(pageRef);
        setCurrentPage(pageIndex + 1);
      }
    } catch (err) {
      console.error('Error navigating to destination:', err);
    }
  };

  // Toggle node expansion
  const toggleNode = (nodePath: string) => {
    setExpandedNodes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(nodePath)) {
        newSet.delete(nodePath);
      } else {
        newSet.add(nodePath);
      }
      return newSet;
    });
  };

  // Collapse all nodes
  const collapseAll = () => {
    setExpandedNodes(new Set());
  };

  // Get all descendant node paths recursively
  const getAllDescendantPaths = (items: OutlineNode[], parentPath: string): string[] => {
    const paths: string[] = [];
    items.forEach((item, index) => {
      const nodePath = `${parentPath}/${index}`;
      paths.push(nodePath);
      if (item.items && item.items.length > 0) {
        paths.push(...getAllDescendantPaths(item.items, nodePath));
      }
    });
    return paths;
  };

  // Toggle node selection with cascading to children
  const toggleNodeSelection = (nodePath: string, items: OutlineNode[], e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();

    setSelectedNodes(prev => {
      const newSet = new Set(prev);
      const isChecked = e.target.checked;

      if (isChecked) {
        // Add the node
        newSet.add(nodePath);
        // Add all descendants
        const descendants = getAllDescendantPaths(items, nodePath);
        descendants.forEach(path => newSet.add(path));
      } else {
        // Remove the node
        newSet.delete(nodePath);
        // Remove all descendants
        const descendants = getAllDescendantPaths(items, nodePath);
        descendants.forEach(path => newSet.delete(path));
      }

      return newSet;
    });
  };

  // Render outline tree
  const renderOutlineItems = (items: OutlineNode[], level = 0, parentPath = '') => {
    return (
      <ul className={level === 0 ? 'toc-list' : 'toc-list-nested'} style={{ marginLeft: level * 30 }}>
        {items.map((item, index) => {
          const nodePath = `${parentPath}/${index}`;
          const hasChildren = item.items && item.items.length > 0;
          const isExpanded = expandedNodes.has(nodePath);

          return (
            <li key={index} className="toc-item">
              <div className="toc-item-content">
                <input
                  type="checkbox"
                  className="toc-checkbox"
                  checked={selectedNodes.has(nodePath)}
                  onChange={(e) => toggleNodeSelection(nodePath, item.items || [], e)}
                  onClick={(e) => e.stopPropagation()}
                />
                {hasChildren && (
                  <button
                    onClick={() => toggleNode(nodePath)}
                    className="toc-expand-btn"
                    aria-label={isExpanded ? 'Collapse' : 'Expand'}
                  >
                    {isExpanded ? '▼' : '▶'}
                  </button>
                )}
                {!hasChildren && (
                  <span className="toc-spacer"></span>
                )}
                <button
                  onClick={() => navigateToDestination(item.dest)}
                  className="toc-link-btn"
                >
                  {item.title}
                </button>
              </div>
              {hasChildren && isExpanded && renderOutlineItems(item.items, level + 1, nodePath)}
            </li>
          );
        })}
      </ul>
    );
  };

  const handlePrevPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  };

  const handleZoomIn = () => {
    if (fitToPageScale) {
      setScale((prev) => Math.min(prev + (fitToPageScale * 0.25), fitToPageScale * 3));
    }
  };

  const handleZoomOut = () => {
    if (fitToPageScale) {
      setScale((prev) => Math.max(prev - (fitToPageScale * 0.25), fitToPageScale * 0.25));
    }
  };

  const handleFitToPage = () => {
    if (fitToPageScale) {
      setScale(fitToPageScale);
    }
  };

  const getZoomPercentage = () => {
    if (!fitToPageScale) return 100;
    return Math.round((scale / fitToPageScale) * 100);
  };

  const handlePageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPageInput(e.target.value);
  };

  const handlePageInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const pageNum = parseInt(pageInput, 10);
    if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages) {
      setCurrentPage(pageNum);
    } else {
      // Reset to current page if invalid
      setPageInput(currentPage.toString());
    }
  };

  const handlePageInputBlur = () => {
    const pageNum = parseInt(pageInput, 10);
    if (isNaN(pageNum) || pageNum < 1 || pageNum > totalPages) {
      // Reset to current page if invalid
      setPageInput(currentPage.toString());
    }
  };

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  const handleResizeMove = (e: MouseEvent) => {
    if (isResizing) {
      const newWidth = e.clientX;
      const minToolbarWidth = 650;
      const maxTocWidth = window.innerWidth - minToolbarWidth - 12; // 12px for resize handle
      if (newWidth >= 240 && newWidth <= maxTocWidth) {
        setTocWidth(newWidth);
      }
    }
  };

  const handleResizeEnd = () => {
    setIsResizing(false);
  };

  useEffect(() => {
    if (isResizing) {
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
      document.addEventListener('mousemove', handleResizeMove);
      document.addEventListener('mouseup', handleResizeEnd);
      return () => {
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        document.removeEventListener('mousemove', handleResizeMove);
        document.removeEventListener('mouseup', handleResizeEnd);
      };
    }
  }, [isResizing]);

  return (
    <div className={`pdf-viewer-container ${isResizing ? 'resizing' : ''}`}>
      {/* Table of Contents Sidebar */}
      {showToc && outline.length > 0 && (
        <>
          <div className="toc-sidebar" style={{ width: `${tocWidth}px` }}>
            <div className="toc-toolbar">
              <button onClick={() => setShowToc(false)} className="toc-close-btn">X</button>
              <button onClick={collapseAll} className="toc-collapse-btn">Collapse All</button>
            </div>
            <div className="toc-content">
              <h3>Table of Contents</h3>
              {renderOutlineItems(outline)}
            </div>
          </div>
          <div className="toc-resize-handle" onMouseDown={handleResizeStart}></div>
        </>
      )}

      {/* Main PDF Viewer */}
      <div className="pdf-main-container">
        {/* Toolbar */}
        <div className="pdf-toolbar">
          <div className="pdf-toolbar-left">
            {!showToc && outline.length > 0 && (
              <button onClick={() => setShowToc(true)} className="pdf-toolbar-toc-btn">TOC</button>
            )}
            <button onClick={handlePrevPage} disabled={currentPage <= 1}>
              Previous
            </button>
            <button onClick={handleNextPage} disabled={currentPage >= totalPages}>
              Next
            </button>
          </div>

          <div className="pdf-toolbar-center">
            <form onSubmit={handlePageInputSubmit} className="page-input-form">
              <span>Page </span>
              <input
                type="text"
                value={pageInput}
                onChange={handlePageInputChange}
                onBlur={handlePageInputBlur}
                className="page-input"
              />
              <span> of {totalPages}</span>
            </form>
            <span className="toolbar-separator">|</span>
            <span>{getZoomPercentage()}%</span>
          </div>

          <div className="pdf-toolbar-right">
            <button onClick={handleZoomOut} disabled={!fitToPageScale || scale <= fitToPageScale * 0.25}>
              −
            </button>
            <button onClick={handleZoomIn} disabled={!fitToPageScale || scale >= fitToPageScale * 3}>
              +
            </button>
            <button onClick={handleFitToPage} disabled={!fitToPageScale}>
              Fit
            </button>
          </div>
        </div>

        {/* PDF Canvas */}
        <div ref={containerRef} className="pdf-canvas-container">
          {loading && <div className="pdf-loading">Loading PDF...</div>}
          {error && <div className="pdf-error">{error}</div>}
          {!loading && !error && pdfDoc && (
            <canvas ref={canvasRef} className="pdf-canvas" />
          )}
          {!loading && !error && !pdfDoc && !pdfUrl && (
            <div className="pdf-no-file">
              No PDF loaded. Please upload a PDF file.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
