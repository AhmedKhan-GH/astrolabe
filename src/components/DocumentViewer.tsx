import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import './DocumentViewer.css';

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

export default function DocumentViewer({ pdfUrl }: PDFViewerProps) {
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
  const [treeDropdownOpen, setTreeDropdownOpen] = useState<boolean>(false);
  const [sidebarTab, setSidebarTab] = useState<'toc' | 'pages' | 'canvas'>('toc');
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [pageSelectionStart, setPageSelectionStart] = useState<number | null>(null);
  const [thumbnailRefs, setThumbnailRefs] = useState<Map<number, HTMLCanvasElement>>(new Map());
  const [mainThumbnailRefs, setMainThumbnailRefs] = useState<Map<number, HTMLCanvasElement>>(new Map());
  const [canvasDimensions, setCanvasDimensions] = useState<Map<number, {width: number, height: number}>>(new Map());
  const currentPageThumbnailRef = useRef<HTMLDivElement>(null);
  const [isDraggingSelection, setIsDraggingSelection] = useState<boolean>(false);
  const [dragStartPage, setDragStartPage] = useState<number | null>(null);
  const [dragCurrentPage, setDragCurrentPage] = useState<number | null>(null);
  const pagesSliderRef = useRef<HTMLDivElement>(null);
  const [canvasZoom, setCanvasZoom] = useState<number>(120); // 120px grid size
  const [pagesZoom, setPagesZoom] = useState<number>(120); // 120px width

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

  // Expand all nodes
  const expandAll = () => {
    const allPaths = getAllDescendantPaths(outline, '');
    setExpandedNodes(new Set(allPaths));
  };

  // Deselect all nodes
  const deselectAll = () => {
    setSelectedNodes(new Set());
  };

  // Select all nodes
  const selectAll = () => {
    const allPaths = getAllDescendantPaths(outline, '');
    setSelectedNodes(new Set(allPaths));
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

  // Handle page click for selection
  const handlePageClick = (pageNum: number, e: React.MouseEvent) => {
    if (e.shiftKey && pageSelectionStart !== null) {
      // Select range from pageSelectionStart to pageNum
      const start = Math.min(pageSelectionStart, pageNum);
      const end = Math.max(pageSelectionStart, pageNum);
      const newPages = new Set(selectedPages);
      for (let i = start; i <= end; i++) {
        newPages.add(i);
      }
      setSelectedPages(newPages);
    } else if (e.ctrlKey || e.metaKey) {
      // Toggle single page
      const newPages = new Set(selectedPages);
      if (newPages.has(pageNum)) {
        newPages.delete(pageNum);
      } else {
        newPages.add(pageNum);
      }
      setSelectedPages(newPages);
      setPageSelectionStart(pageNum);
    } else if (!isDraggingSelection) {
      // Navigate to page (only if not dragging)
      setCurrentPage(pageNum);
    }
  };

  // Handle drag selection start
  const handleDragSelectionStart = (pageNum: number, e: React.MouseEvent) => {
    if (e.shiftKey || e.ctrlKey || e.metaKey) return; // Don't start drag if modifier keys

    e.preventDefault();
    setIsDraggingSelection(true);
    setDragStartPage(pageNum);
    setDragCurrentPage(pageNum);
  };

  // Handle drag selection move
  const handleDragSelectionMove = (pageNum: number) => {
    if (isDraggingSelection && dragStartPage !== null) {
      setDragCurrentPage(pageNum);

      // Update selection during drag
      const start = Math.min(dragStartPage, pageNum);
      const end = Math.max(dragStartPage, pageNum);
      const newPages = new Set<number>();
      for (let i = start; i <= end; i++) {
        newPages.add(i);
      }
      setSelectedPages(newPages);
    }
  };

  // Handle drag selection end
  const handleDragSelectionEnd = () => {
    if (isDraggingSelection) {
      setIsDraggingSelection(false);
      if (dragStartPage !== null && dragCurrentPage !== null) {
        setPageSelectionStart(dragStartPage);
      }
      setDragStartPage(null);
      setDragCurrentPage(null);
    }
  };

  // Global mouse up handler for drag selection
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (isDraggingSelection) {
        handleDragSelectionEnd();
      }
    };

    if (isDraggingSelection) {
      document.addEventListener('mouseup', handleGlobalMouseUp);
      return () => {
        document.removeEventListener('mouseup', handleGlobalMouseUp);
      };
    }
  }, [isDraggingSelection]);

  // Clear page selections
  const clearPageSelections = () => {
    setSelectedPages(new Set());
    setPageSelectionStart(null);
  };

  // Select all pages
  const selectAllPages = () => {
    const allPages = new Set<number>();
    for (let i = 1; i <= totalPages; i++) {
      allPages.add(i);
    }
    setSelectedPages(allPages);
  };

  // Render thumbnail for a page with configurable scale and display size
  const renderPageThumbnail = async (pageNum: number, canvas: HTMLCanvasElement, renderScale: number = 0.25, displayScale: number = 1) => {
    if (!pdfDoc || !canvas) return;

    try {
      const page: PDFPageProxy = await pdfDoc.getPage(pageNum);
      // Render at low resolution for efficiency
      const viewport = page.getViewport({ scale: renderScale });

      const context = canvas.getContext('2d');
      if (!context) return;

      // Render at low res
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);

      // Store dimensions for later sizing
      setCanvasDimensions(prev => new Map(prev).set(pageNum, {
        width: canvas.width,
        height: canvas.height
      }));

      // Display at larger size
      canvas.style.width = Math.floor(viewport.width * displayScale) + 'px';
      canvas.style.height = Math.floor(viewport.height * displayScale) + 'px';

      // Disable image smoothing for pixelated effect
      context.imageSmoothingEnabled = false;

      const renderContext = {
        canvasContext: context,
        viewport: viewport,
      };

      await page.render(renderContext).promise;
    } catch (err) {
      console.error(`Error rendering thumbnail for page ${pageNum}:`, err);
    }
  };

  // Set canvas ref and render thumbnail
  const setThumbnailRef = (pageNum: number) => (canvas: HTMLCanvasElement | null) => {
    if (canvas) {
      const existingCanvas = thumbnailRefs.get(pageNum);
      if (existingCanvas !== canvas) {
        setThumbnailRefs(prev => new Map(prev).set(pageNum, canvas));
        // Render at 0.25 scale (4:1 reduction), CSS will handle display size
        renderPageThumbnail(pageNum, canvas, 0.25, 1);
      }
    }
  };

  // Set canvas ref and render main thumbnail with small scale
  const setMainThumbnailRef = (pageNum: number) => (canvas: HTMLCanvasElement | null) => {
    if (canvas) {
      const existingCanvas = mainThumbnailRefs.get(pageNum);
      if (existingCanvas !== canvas) {
        setMainThumbnailRefs(prev => new Map(prev).set(pageNum, canvas));
        // Render at 0.25 scale (4:1 reduction), CSS will handle display size
        renderPageThumbnail(pageNum, canvas, 0.25, 1);
      }
    }
  };

  // Update Canvas thumbnail sizes when switching tabs or zoom changes
  useEffect(() => {
    if (sidebarTab === 'canvas') {
      mainThumbnailRefs.forEach((canvas, pageNum) => {
        const dims = canvasDimensions.get(pageNum);
        if (dims) {
          const aspectRatio = dims.height / dims.width;
          const canvasWidth = canvasZoom - 4;
          const displayHeight = canvasWidth * aspectRatio;
          canvas.style.width = `${canvasWidth}px`;
          canvas.style.height = `${displayHeight}px`;
        }
      });
    }
  }, [sidebarTab, canvasZoom, mainThumbnailRefs, canvasDimensions]);

  // Update Pages thumbnail sizes when switching tabs or zoom changes
  useEffect(() => {
    if (sidebarTab === 'pages') {
      thumbnailRefs.forEach((canvas, pageNum) => {
        const dims = canvasDimensions.get(pageNum);
        if (dims) {
          const aspectRatio = dims.height / dims.width;
          canvas.style.width = `${pagesZoom}px`;
          canvas.style.height = `${pagesZoom * aspectRatio}px`;
        }
      });
    }
  }, [sidebarTab, pagesZoom, thumbnailRefs, canvasDimensions]);

  // Scroll current page thumbnail into view
  useEffect(() => {
    if (sidebarTab === 'pages' && currentPageThumbnailRef.current) {
      currentPageThumbnailRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [currentPage, sidebarTab]);

  // Render pages view
  const renderPagesView = () => {
    return (
      <div className="pages-view">
        <div className="pages-slider" ref={pagesSliderRef} style={{ '--pages-zoom': pagesZoom } as React.CSSProperties}>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map(pageNum => (
            <div
              key={pageNum}
              ref={pageNum === currentPage ? currentPageThumbnailRef : null}
              className={`page-thumbnail ${pageNum === currentPage ? 'current-page' : ''} ${selectedPages.has(pageNum) ? 'selected-page' : ''}`}
              onClick={(e) => handlePageClick(pageNum, e)}
              onMouseDown={(e) => handleDragSelectionStart(pageNum, e)}
              onMouseEnter={() => handleDragSelectionMove(pageNum)}
              title={`Page ${pageNum}`}
            >
              <canvas
                ref={setThumbnailRef(pageNum)}
                className="page-thumbnail-canvas"
                style={{
                  width: `${pagesZoom}px`,
                  height: (() => {
                    const dims = canvasDimensions.get(pageNum);
                    if (dims) {
                      const aspectRatio = dims.height / dims.width;
                      return `${pagesZoom * aspectRatio}px`;
                    }
                    return 'auto';
                  })()
                }}
              />
              <div className="page-thumbnail-number">{pageNum}</div>
            </div>
          ))}
        </div>
        <div className="pages-instructions">
          Click to navigate • Drag to select range • Ctrl+Click to toggle • Shift+Click for range
        </div>
      </div>
    );
  };

  // Render canvas view with very small canvases in reflowable grid
  const renderCanvasView = () => {
    return (
      <div className="canvas-view">
        <div className="canvas-grid" style={{ '--canvas-zoom': `${canvasZoom}px` } as React.CSSProperties}>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map(pageNum => {
            const dims = canvasDimensions.get(pageNum);
            const aspectRatio = dims ? dims.height / dims.width : 1.414; // Default to A4 ratio
            // Subtract padding from canvas size to fit within grid cell
            const canvasWidth = canvasZoom - 4; // Account for 2px padding on each side
            const displayHeight = canvasWidth * aspectRatio;
            return (
              <div
                key={pageNum}
                className={`canvas-item ${pageNum === currentPage ? 'current-page' : ''}`}
                onClick={() => setCurrentPage(pageNum)}
                title={`Page ${pageNum}`}
              >
                <canvas
                  ref={setMainThumbnailRef(pageNum)}
                  className="canvas-thumbnail"
                  style={{ width: `${canvasWidth}px`, height: `${displayHeight}px` }}
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // Render outline tree
  const renderOutlineItems = (items: OutlineNode[], level = 0, parentPath = '') => {
    return (
      <ul className={level === 0 ? 'toc-list' : 'toc-list-nested'}>
        {items.map((item, index) => {
          const nodePath = `${parentPath}/${index}`;
          const hasChildren = item.items && item.items.length > 0;
          const isExpanded = expandedNodes.has(nodePath);

          return (
            <li key={index} className="toc-item">
              <div className="toc-item-content" style={{ paddingLeft: `${level * 26}px` }}>
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
      if (newWidth >= 320 && newWidth <= maxTocWidth) {
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
      {showToc && (
        <>
          <div className="toc-sidebar" style={{ width: `${tocWidth}px` }}>
            <div className="toc-toolbar">
              <div className="toc-toolbar-top">
                <button onClick={() => setShowToc(false)} className="toc-close-btn">☰</button>
                <div className="sidebar-tabs">
                  {outline.length > 0 && (
                    <button
                      onClick={() => setSidebarTab('toc')}
                      className={`sidebar-tab ${sidebarTab === 'toc' ? 'active' : ''}`}
                    >
                      Table
                    </button>
                  )}
                  <button
                    onClick={() => setSidebarTab('pages')}
                    className={`sidebar-tab ${sidebarTab === 'pages' ? 'active' : ''}`}
                  >
                    Pages
                  </button>
                  <button
                    onClick={() => setSidebarTab('canvas')}
                    className={`sidebar-tab ${sidebarTab === 'canvas' ? 'active' : ''}`}
                  >
                    Canvas
                  </button>
                </div>
              </div>
              <div className="toc-toolbar-bottom">
                <button className="toc-collapse-btn">Create Note</button>
                {sidebarTab === 'toc' && outline.length > 0 && (
                  <div className="toc-dropdown">
                    <button
                      onClick={() => setTreeDropdownOpen(!treeDropdownOpen)}
                      className="toc-dropdown-btn"
                    >
                      Selection {treeDropdownOpen ? '▼' : '▶'}
                    </button>
                    {treeDropdownOpen && (
                      <div className="toc-dropdown-menu">
                        <button
                          onClick={() => { expandAll(); setTreeDropdownOpen(false); }}
                          className="toc-dropdown-item"
                        >
                          Expand All
                        </button>
                        <button
                          onClick={() => { collapseAll(); setTreeDropdownOpen(false); }}
                          className="toc-dropdown-item"
                        >
                          Collapse All
                        </button>
                        <button
                          onClick={() => { selectAll(); setTreeDropdownOpen(false); }}
                          className="toc-dropdown-item"
                        >
                          Select All
                        </button>
                        <button
                          onClick={() => { deselectAll(); setTreeDropdownOpen(false); }}
                          className="toc-dropdown-item"
                        >
                          Deselect All
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {sidebarTab === 'pages' && (
                  <div className="toc-dropdown">
                    <button
                      onClick={() => setTreeDropdownOpen(!treeDropdownOpen)}
                      className="toc-dropdown-btn"
                    >
                      Selection {treeDropdownOpen ? '▼' : '▶'}
                    </button>
                    {treeDropdownOpen && (
                      <div className="toc-dropdown-menu">
                        <button
                          onClick={() => { selectAllPages(); setTreeDropdownOpen(false); }}
                          className="toc-dropdown-item"
                        >
                          Select All
                        </button>
                        <button
                          onClick={() => { clearPageSelections(); setTreeDropdownOpen(false); }}
                          className="toc-dropdown-item"
                        >
                          Deselect All
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
              {sidebarTab === 'canvas' && (
                <div className="toc-toolbar-zoom">
                  <label htmlFor="canvas-zoom">Thumbnail Size:</label>
                  <input
                    id="canvas-zoom"
                    type="range"
                    min="25"
                    max="500"
                    value={canvasZoom}
                    onChange={(e) => setCanvasZoom(Number(e.target.value))}
                    className="zoom-slider"
                  />
                  <span className="zoom-value">{canvasZoom}px</span>
                </div>
              )}
              {sidebarTab === 'pages' && (
                <div className="toc-toolbar-zoom">
                  <label htmlFor="pages-zoom">Thumbnail Size:</label>
                  <input
                    id="pages-zoom"
                    type="range"
                    min="25"
                    max="500"
                    value={pagesZoom}
                    onChange={(e) => setPagesZoom(Number(e.target.value))}
                    className="zoom-slider"
                  />
                  <span className="zoom-value">{pagesZoom}px</span>
                </div>
              )}
            </div>
            <div className="toc-content">
              {sidebarTab === 'toc' && outline.length > 0 && (
                <>
                  <h3>Table of Contents</h3>
                  {renderOutlineItems(outline)}
                </>
              )}
              {sidebarTab === 'pages' && (
                <>
                  <h3>Pages ({totalPages} total)</h3>
                  {totalPages > 0 && renderPagesView()}
                </>
              )}
              {sidebarTab === 'canvas' && (
                <>
                  <h3>Canvas ({totalPages} total)</h3>
                  {totalPages > 0 && renderCanvasView()}
                </>
              )}
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
            {!showToc && (
              <button onClick={() => setShowToc(true)} className="pdf-toolbar-toc-btn">
                ☰
              </button>
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
