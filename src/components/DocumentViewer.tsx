import { useEffect, useRef, useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { saveNote, getNotesForFile, deleteNote, type StoredNote } from '../utils/noteStorage';
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

interface Note {
  id: string;
  title: string;
  tocPaths: Set<string>;
  pageRanges: number[];
  createdAt: Date;
}

interface PDFViewerProps {
  pdfUrl?: string;
  fileId?: string;
  isParentResizing?: boolean;
  availableWidth?: number;
}

export default function DocumentViewer({ pdfUrl, fileId, isParentResizing = false, availableWidth }: PDFViewerProps) {
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
  const [showRightSidebar, setShowRightSidebar] = useState(true);
  const [rightSidebarWidth, setRightSidebarWidth] = useState<number>(300);
  const [isResizingRight, setIsResizingRight] = useState<boolean>(false);
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
  const [treeDropdownOpen, setTreeDropdownOpen] = useState<boolean>(false);
  const [gotoDropdownOpen, setGotoDropdownOpen] = useState<boolean>(false);
  const [sidebarTab, setSidebarTab] = useState<'toc' | 'pages' | 'canvas'>('toc');
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [pageSelectionStart, setPageSelectionStart] = useState<number | null>(null);
  const [thumbnailRefs, setThumbnailRefs] = useState<Map<number, HTMLCanvasElement>>(new Map());
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeNote, setActiveNote] = useState<Note | null>(null);
  const [tocPageMap, setTocPageMap] = useState<Map<string, number[]>>(new Map());
  const [mainThumbnailRefs, setMainThumbnailRefs] = useState<Map<number, HTMLCanvasElement>>(new Map());
  const [canvasDimensions, setCanvasDimensions] = useState<Map<number, {width: number, height: number}>>(new Map());
  const currentPageThumbnailRef = useRef<HTMLDivElement>(null);
  const [isDraggingSelection, setIsDraggingSelection] = useState<boolean>(false);
  const [dragStartPage, setDragStartPage] = useState<number | null>(null);
  const [dragCurrentPage, setDragCurrentPage] = useState<number | null>(null);
  const pagesSliderRef = useRef<HTMLDivElement>(null);
  const canvasGridRef = useRef<HTMLDivElement>(null);
  const [canvasZoom, setCanvasZoom] = useState<number>(120); // 120px grid size
  const [pagesZoom, setPagesZoom] = useState<number>(120); // 120px width
  const tocDropdownRef = useRef<HTMLDivElement>(null);
  const pagesDropdownRef = useRef<HTMLDivElement>(null);
  const gotoDropdownRef = useRef<HTMLDivElement>(null);
  const [visibleThumbnails, setVisibleThumbnails] = useState<Set<number>>(new Set());
  const thumbnailObserverRef = useRef<IntersectionObserver | null>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState<boolean>(false);

  // Load persisted notes for this file
  useEffect(() => {
    if (!fileId) {
      console.log('DocumentViewer: No fileId, skipping note load');
      return;
    }

    console.log('DocumentViewer: Loading notes for fileId:', fileId);

    const loadNotes = async () => {
      try {
        const storedNotes = await getNotesForFile(fileId);
        console.log('DocumentViewer: Loaded notes from DB:', storedNotes);
        const notes: Note[] = storedNotes.map(sn => ({
          id: sn.id,
          title: sn.title,
          tocPaths: new Set(sn.tocPaths),
          pageRanges: sn.pageRanges,
          createdAt: new Date(sn.createdAt)
        }));
        setNotes(notes);
        console.log('DocumentViewer: Set notes state:', notes);
      } catch (error) {
        console.error('Failed to load notes:', error);
      }
    };

    loadNotes();
  }, [fileId]);

  // Initialize intersection observer for lazy thumbnail loading
  useEffect(() => {
    thumbnailObserverRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const pageNum = parseInt(entry.target.getAttribute('data-page') || '0', 10);
          if (entry.isIntersecting && pageNum > 0) {
            setVisibleThumbnails(prev => new Set(prev).add(pageNum));
          }
        });
      },
      {
        root: null,
        rootMargin: '200px', // Load thumbnails 200px before they come into view
        threshold: 0.01
      }
    );

    return () => {
      if (thumbnailObserverRef.current) {
        thumbnailObserverRef.current.disconnect();
      }
    };
  }, []);

  // Update page input when current page changes
  useEffect(() => {
    setPageInput(currentPage.toString());
  }, [currentPage]);

  // Close dropdown when clicking outside or switching tabs
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const tocDropdown = tocDropdownRef.current;
      const pagesDropdown = pagesDropdownRef.current;
      const gotoDropdown = gotoDropdownRef.current;

      if (tocDropdown && !tocDropdown.contains(event.target as Node)) {
        setTreeDropdownOpen(false);
      }
      if (pagesDropdown && !pagesDropdown.contains(event.target as Node)) {
        setTreeDropdownOpen(false);
      }
      if (gotoDropdown && !gotoDropdown.contains(event.target as Node)) {
        setGotoDropdownOpen(false);
      }
    };

    if (treeDropdownOpen || gotoDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [treeDropdownOpen, gotoDropdownOpen]);

  // Close dropdown when switching tabs
  useEffect(() => {
    setTreeDropdownOpen(false);
    setGotoDropdownOpen(false);
  }, [sidebarTab]);

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
        } else {
          // If no outline and currently on toc tab, switch to pages
          if (sidebarTab === 'toc') {
            setSidebarTab('pages');
          }
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

  // Get page number for a destination
  const getPageForDestination = async (dest: any): Promise<number | null> => {
    if (!pdfDoc) return null;

    try {
      let destination = dest;
      if (typeof dest === 'string') {
        destination = await pdfDoc.getDestination(dest);
      }

      if (destination && Array.isArray(destination)) {
        const pageRef = destination[0];
        const pageIndex = await pdfDoc.getPageIndex(pageRef);
        return pageIndex + 1;
      }
    } catch (err) {
      console.error('Error getting page for destination:', err);
    }
    return null;
  };

  // Build map of TOC paths to page numbers
  useEffect(() => {
    if (!pdfDoc || outline.length === 0) return;

    const buildPageMap = async () => {
      const pageMap = new Map<string, number[]>();

      // Build a flat list of all items with structural info
      const allItems: Array<{
        path: string;
        page: number;
        parentPath: string;
        siblingIndex: number;
      }> = [];

      const collectItems = async (items: OutlineNode[], parentPath: string) => {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const nodePath = `${parentPath}/${i}`;
          const pageNum = await getPageForDestination(item.dest);

          if (pageNum !== null) {
            allItems.push({
              path: nodePath,
              page: pageNum,
              parentPath: parentPath,
              siblingIndex: i
            });
          }

          if (item.items && item.items.length > 0) {
            await collectItems(item.items, nodePath);
          }
        }
      };

      await collectItems(outline, '');

      // For each item, find where its section ends
      for (const currentItem of allItems) {
        const startPage = currentItem.page;
        let endPage = totalPages;

        // Find the next item that is NOT a descendant of current item
        // This will be either:
        // - A sibling (next item at same level)
        // - An uncle (parent's next sibling)
        // - Or any ancestor's next sibling
        for (const otherItem of allItems) {
          // Skip if same item or if it comes before current item
          if (otherItem.path === currentItem.path || otherItem.page <= startPage) {
            continue;
          }

          // Check if otherItem is a descendant of currentItem
          const isDescendant = otherItem.path.startsWith(currentItem.path + '/');

          // If it's NOT a descendant and comes after, this is where our section ends
          if (!isDescendant) {
            endPage = otherItem.page - 1;
            break;
          }
        }

        // Generate page range
        const pages: number[] = [];
        for (let p = startPage; p <= endPage; p++) {
          pages.push(p);
        }
        pageMap.set(currentItem.path, pages);
      }

      setTocPageMap(pageMap);
    };

    buildPageMap();
  }, [pdfDoc, outline, totalPages]);

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

  // Expand only nodes in active note
  const expandNote = () => {
    if (!activeNote) return;

    setExpandedNodes(prev => {
      const newSet = new Set(prev);

      // Get all paths that are in the active note and have children
      activeNote.tocPaths.forEach(path => {
        // Find the node to check if it has children
        const pathParts = path.split('/').filter(p => p).map(Number);
        let current: OutlineNode[] = outline;
        let node: OutlineNode | null = null;

        for (const index of pathParts) {
          if (index >= 0 && index < current.length) {
            node = current[index];
            current = node.items || [];
          } else {
            node = null;
            break;
          }
        }

        // If node has children, add it to expand list
        if (node && node.items && node.items.length > 0) {
          newSet.add(path);
        }
      });

      return newSet;
    });
  };

  // Collapse only nodes in active note
  const collapseNote = () => {
    if (!activeNote) return;

    setExpandedNodes(prev => {
      const newSet = new Set(prev);
      // Remove all paths that are in the active note
      activeNote.tocPaths.forEach(path => {
        newSet.delete(path);
      });
      return newSet;
    });
  };

  // Expand only selected (checked) nodes
  const expandChecked = () => {
    if (selectedNodes.size === 0) return;

    setExpandedNodes(prev => {
      const newSet = new Set(prev);

      // Get all checked paths that have children
      selectedNodes.forEach(path => {
        // Find the node to check if it has children
        const pathParts = path.split('/').filter(p => p).map(Number);
        let current: OutlineNode[] = outline;
        let node: OutlineNode | null = null;

        for (const index of pathParts) {
          if (index >= 0 && index < current.length) {
            node = current[index];
            current = node.items || [];
          } else {
            node = null;
            break;
          }
        }

        // If node has children, add it to expand list
        if (node && node.items && node.items.length > 0) {
          newSet.add(path);
        }
      });

      return newSet;
    });
  };

  // Collapse only selected (checked) nodes
  const collapseChecked = () => {
    if (selectedNodes.size === 0) return;

    setExpandedNodes(prev => {
      const newSet = new Set(prev);
      // Remove all paths that are checked
      selectedNodes.forEach(path => {
        newSet.delete(path);
      });
      return newSet;
    });
  };

  // Go to the first page/item of the active note (with one element buffer above)
  const goToNote = () => {
    if (!activeNote) return;

    // Navigate to first page in the note
    if (activeNote.pageRanges.length > 0) {
      const firstPage = Math.min(...activeNote.pageRanges);
      setCurrentPage(firstPage);

      // Handle scrolling based on active tab
      if (sidebarTab === 'toc') {
        // Expand and scroll to first TOC item with one line buffer above
        const firstTocPath = Array.from(activeNote.tocPaths).sort()[0];
        if (firstTocPath) {
          // Expand parent nodes
          const pathParts = firstTocPath.split('/').filter(p => p);
          const parentsToExpand = new Set(expandedNodes);
          for (let i = 1; i < pathParts.length; i++) {
            const parentPath = '/' + pathParts.slice(0, i).join('/');
            parentsToExpand.add(parentPath);
          }
          setExpandedNodes(parentsToExpand);

          // Scroll to one line above the first TOC item
          setTimeout(() => {
            // Get all visible TOC items in the rendered order
            const allTocItems = Array.from(document.querySelectorAll('.toc-item[data-toc-path]'));
            const firstTocElement = allTocItems.find(el => el.getAttribute('data-toc-path') === firstTocPath);

            if (firstTocElement) {
              // Find the index of the first element in the visible list
              const firstIndex = allTocItems.indexOf(firstTocElement);

              // If there's a previous item, scroll to it for buffer
              if (firstIndex > 0) {
                allTocItems[firstIndex - 1].scrollIntoView({ behavior: 'smooth', block: 'start' });
              } else {
                // If no previous element, just scroll to first
                firstTocElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
            }
          }, 100);
        }
      } else if (sidebarTab === 'pages') {
        // Scroll to one page above the first note page
        setTimeout(() => {
          const targetPage = Math.max(1, firstPage - 1);
          const allPages = document.querySelectorAll('.page-thumbnail');
          if (allPages.length >= targetPage) {
            allPages[targetPage - 1].scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }, 100);
      } else if (sidebarTab === 'canvas') {
        // Scroll to one row above the first canvas page
        setTimeout(() => {
          const canvasItems = canvasGridRef.current?.querySelectorAll('.canvas-item');
          if (canvasItems && canvasItems.length > 0) {
            // Calculate how many items per row based on grid
            const gridElement = canvasGridRef.current;
            if (gridElement) {
              const gridWidth = gridElement.clientWidth;
              const itemWidth = canvasZoom;
              const itemsPerRow = Math.floor(gridWidth / itemWidth) || 1;

              // Go back one row (or to start if not enough items)
              const targetIndex = Math.max(0, firstPage - 1 - itemsPerRow);
              canvasItems[targetIndex].scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          }
        }, 100);
      }
    }
  };

  // Go to top of the current view
  const goToTop = () => {
    if (sidebarTab === 'toc') {
      const tocContent = document.querySelector('.toc-tab-panel.active');
      if (tocContent) {
        tocContent.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } else if (sidebarTab === 'pages') {
      const pagesSlider = pagesSliderRef.current;
      if (pagesSlider) {
        pagesSlider.scrollTo({ top: 0, behavior: 'smooth' });
      }
    } else if (sidebarTab === 'canvas') {
      const canvasView = document.querySelector('.canvas-view');
      if (canvasView) {
        canvasView.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
  };

  // Go to bottom of the current view
  const goToBottom = () => {
    if (sidebarTab === 'toc') {
      const tocContent = document.querySelector('.toc-tab-panel.active');
      if (tocContent) {
        tocContent.scrollTo({ top: tocContent.scrollHeight, behavior: 'smooth' });
      }
    } else if (sidebarTab === 'pages') {
      const pagesSlider = pagesSliderRef.current;
      if (pagesSlider) {
        pagesSlider.scrollTo({ top: pagesSlider.scrollHeight, behavior: 'smooth' });
      }
    } else if (sidebarTab === 'canvas') {
      const canvasView = document.querySelector('.canvas-view');
      if (canvasView) {
        canvasView.scrollTo({ top: canvasView.scrollHeight, behavior: 'smooth' });
      }
    }
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

  // Find minimal TOC paths that comprehensively cover given pages
  const findTocPathsForPages = (pages: Set<number>): Set<string> => {
    if (pages.size === 0 || tocPageMap.size === 0) return new Set();

    const coveredPaths = new Set<string>();

    // Build a list of all TOC items with their page ranges
    const tocItems: Array<{ path: string; pages: number[]; level: number }> = [];

    tocPageMap.forEach((pageRange, path) => {
      const level = path.split('/').filter(p => p).length;
      tocItems.push({ path, pages: pageRange, level });
    });

    // Sort by level (prefer higher level/parent sections) and then by path
    tocItems.sort((a, b) => {
      if (a.level !== b.level) return a.level - b.level;
      return a.path.localeCompare(b.path);
    });

    // Greedy algorithm: pick the largest sections that cover the most uncovered pages
    const uncoveredPages = new Set(pages);

    for (const item of tocItems) {
      if (uncoveredPages.size === 0) break;

      // Check how many of our target pages this TOC item covers
      const coveredByThis = item.pages.filter(p => uncoveredPages.has(p));

      if (coveredByThis.length > 0) {
        // Check if this item is already covered by a parent we've selected
        const isChildOfSelected = Array.from(coveredPaths).some(selectedPath => 
          item.path.startsWith(selectedPath + '/')
        );

        if (!isChildOfSelected) {
          coveredPaths.add(item.path);
          // Remove covered pages
          coveredByThis.forEach(p => uncoveredPages.delete(p));

          // Remove any children of this path that we might have added
          const childrenToRemove = Array.from(coveredPaths).filter(path => 
            path.startsWith(item.path + '/') && path !== item.path
          );
          childrenToRemove.forEach(path => coveredPaths.delete(path));
        }
      }
    }

    return coveredPaths;
  };

  // Create note from selected TOC items or pages
  const createNoteFromSelection = () => {
    let tocPaths: Set<string>;
    let pageRanges: number[];
    let defaultTitle = 'New Note';

    if (sidebarTab === 'toc') {
      // Creating from TOC selection
      if (selectedNodes.size === 0) {
        alert('Please select at least one TOC item');
        return;
      }

      // Simply collect all pages from selected TOC items
      const allPages = new Set<number>();
      selectedNodes.forEach(path => {
        const pages = tocPageMap.get(path);
        if (pages) {
          pages.forEach(p => allPages.add(p));
        }
      });

      pageRanges = Array.from(allPages).sort((a, b) => a - b);
      tocPaths = new Set(selectedNodes);

      // Generate default title from first selected item
      const firstPath = Array.from(selectedNodes)[0];
      const pathParts = firstPath.split('/').filter(p => p);

      if (pathParts.length > 0) {
        const findNodeByPath = (items: OutlineNode[], path: string): OutlineNode | null => {
          const parts = path.split('/').filter(p => p).map(Number);
          let current: OutlineNode[] = items;
          let node: OutlineNode | null = null;

          for (const index of parts) {
            if (index >= 0 && index < current.length) {
              node = current[index];
              current = node.items || [];
            } else {
              return null;
            }
          }
          return node;
        };

        const firstNode = findNodeByPath(outline, firstPath);
        if (firstNode) {
          defaultTitle = firstNode.title;
        }
      }
    } else {
      // Creating from Pages or Canvas selection
      if (selectedPages.size === 0) {
        alert('Please select at least one page');
        return;
      }

      pageRanges = Array.from(selectedPages).sort((a, b) => a - b);
      tocPaths = findTocPathsForPages(selectedPages);

      // Generate default title from page range
      if (pageRanges.length === 1) {
        defaultTitle = `Page ${pageRanges[0]}`;
      } else {
        defaultTitle = `Pages ${pageRanges[0]}-${pageRanges[pageRanges.length - 1]}`;
      }
    }

    const noteTitle = prompt('Enter note title:', defaultTitle);
    if (!noteTitle) return;

    const newNote: Note = {
      id: Date.now().toString(),
      title: noteTitle,
      tocPaths: tocPaths,
      pageRanges: pageRanges,
      createdAt: new Date(),
    };

    setNotes(prev => [...prev, newNote]);
    setActiveNote(newNote);
    setSelectedNodes(new Set());
    setSelectedPages(new Set());

    // Persist to database
    if (fileId) {
      const storedNote: StoredNote = {
        id: newNote.id,
        fileId: fileId,
        title: newNote.title,
        tocPaths: Array.from(newNote.tocPaths),
        pageRanges: newNote.pageRanges,
        createdAt: newNote.createdAt.getTime()
      };
      console.log('DocumentViewer: Saving note to DB:', storedNote);
      saveNote(storedNote).then(() => {
        console.log('DocumentViewer: Note saved successfully');
      }).catch(err => {
        console.error('Failed to save note:', err);
      });
    } else {
      console.warn('DocumentViewer: No fileId, cannot save note');
    }
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
      // Also navigate to the clicked page
      setCurrentPage(pageNum);
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
      // Also navigate to the clicked page
      setCurrentPage(pageNum);
    } else if (!isDraggingSelection) {
      // Navigate to page without affecting selection
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

  // ESC key handler to clear selections
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (sidebarTab === 'pages' || sidebarTab === 'canvas')) {
        clearPageSelections();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [sidebarTab]);

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
  const renderPageThumbnail = useCallback(async (pageNum: number, canvas: HTMLCanvasElement, renderScale: number = 0.25, displayScale: number = 1, forcePriority: boolean = false) => {
    if (!pdfDoc || !canvas) return;

    // Only render if visible, within range of current page, or forced priority
    const shouldRender = forcePriority || visibleThumbnails.has(pageNum) || Math.abs(pageNum - currentPage) <= 3;
    if (!shouldRender && sidebarTab !== 'toc') return;

    try {
      const page: PDFPageProxy = await pdfDoc.getPage(pageNum);
      // Render at low resolution for efficiency
      const viewport = page.getViewport({ scale: renderScale });

      const context = canvas.getContext('2d', { alpha: false });
      if (!context) return;

      // Render at low res
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);

      // Always store/update dimensions to ensure consistency
      setCanvasDimensions(prev => {
        const newMap = new Map(prev);
        newMap.set(pageNum, {
          width: canvas.width,
          height: canvas.height
        });
        return newMap;
      });

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
  }, [pdfDoc, visibleThumbnails, currentPage, sidebarTab]);

  // Set canvas ref and render thumbnail
  const setThumbnailRef = (pageNum: number) => (canvas: HTMLCanvasElement | null) => {
    if (canvas) {
      const existingCanvas = thumbnailRefs.get(pageNum);
      if (existingCanvas !== canvas) {
        setThumbnailRefs(prev => new Map(prev).set(pageNum, canvas));

        // Observe the canvas parent for lazy loading
        const parent = canvas.parentElement;
        if (parent && thumbnailObserverRef.current) {
          parent.setAttribute('data-page', pageNum.toString());
          thumbnailObserverRef.current.observe(parent);
        }

        // Render at 0.5 scale (2:1 reduction), CSS will handle display size
        renderPageThumbnail(pageNum, canvas, 0.5, 1);
      }
    }
  };

  // Set canvas ref and render main thumbnail with small scale
  const setMainThumbnailRef = (pageNum: number) => (canvas: HTMLCanvasElement | null) => {
    if (canvas) {
      const existingCanvas = mainThumbnailRefs.get(pageNum);
      if (existingCanvas !== canvas) {
        setMainThumbnailRefs(prev => new Map(prev).set(pageNum, canvas));

        // Observe the canvas parent for lazy loading
        const parent = canvas.parentElement;
        if (parent && thumbnailObserverRef.current) {
          parent.setAttribute('data-page', pageNum.toString());
          thumbnailObserverRef.current.observe(parent);
        }

        // Render at 0.25 scale (4:1 reduction), CSS will handle display size
        renderPageThumbnail(pageNum, canvas, 0.25, 1);
      }
    }
  };

  // Update Canvas thumbnail sizes when switching tabs or zoom changes
  useEffect(() => {
    if (sidebarTab === 'canvas' && canvasGridRef.current) {
      // Force reflow by reading layout property
      void canvasGridRef.current.offsetHeight;

      // Force grid to recalculate by updating the CSS variable
      const availableWidth = canvasGridRef.current.clientWidth - 8;
      const effectiveGridSize = Math.min(canvasZoom, availableWidth + 4);
      canvasGridRef.current.style.setProperty('--canvas-zoom', `${effectiveGridSize}px`);

      // Force another reflow after style update
      void canvasGridRef.current.offsetHeight;

      mainThumbnailRefs.forEach((canvas, pageNum) => {
        const dims = canvasDimensions.get(pageNum);
        if (dims) {
          const aspectRatio = dims.height / dims.width;
          // Cap width at both grid cell size and available width - same as Pages
          const targetWidth = canvasZoom - 4;
          const constrainedWidth = Math.min(targetWidth, availableWidth);
          const newWidth = `${constrainedWidth}px`;
          const newHeight = `${constrainedWidth * aspectRatio}px`;
          const newMaxWidth = `${availableWidth}px`;

          // Only update if dimensions actually changed
          if (canvas.style.width !== newWidth || canvas.style.height !== newHeight || canvas.style.maxWidth !== newMaxWidth) {
            canvas.style.width = newWidth;
            canvas.style.height = newHeight;
            canvas.style.maxWidth = newMaxWidth;
          }
        }
      });

      // After resizing, scroll to keep current page in view
      setTimeout(() => {
        const canvasItems = canvasGridRef.current?.querySelectorAll('.canvas-item');
        if (canvasItems && canvasItems.length >= currentPage) {
          canvasItems[currentPage - 1].scrollIntoView({ behavior: 'auto', block: 'center' });
        }
      }, 0);
    }
  }, [sidebarTab, canvasZoom]);

  // Maintain thumbnail sizes when active note changes in canvas view
  useEffect(() => {
    if (sidebarTab === 'canvas' && canvasGridRef.current) {
      const availableWidth = canvasGridRef.current.clientWidth - 8;

      mainThumbnailRefs.forEach((canvas, pageNum) => {
        const dims = canvasDimensions.get(pageNum);
        if (dims) {
          const aspectRatio = dims.height / dims.width;
          const targetWidth = canvasZoom - 4;
          const constrainedWidth = Math.min(targetWidth, availableWidth);

          canvas.style.width = `${constrainedWidth}px`;
          canvas.style.height = `${constrainedWidth * aspectRatio}px`;
          canvas.style.maxWidth = `${availableWidth}px`;
        }
      });
    }
  }, [activeNote?.id, sidebarTab, canvasZoom, mainThumbnailRefs, canvasDimensions]);

  // Update Pages thumbnail sizes when switching tabs or zoom changes
  useEffect(() => {
    if (sidebarTab === 'pages' && pagesSliderRef.current) {
      // Force reflow by reading layout property
      void pagesSliderRef.current.offsetHeight;

      // Calculate available width (sidebar width minus padding and margins for visual breathing room)
      const availableWidth = pagesSliderRef.current.clientWidth - 68;

      thumbnailRefs.forEach((canvas, pageNum) => {
        const dims = canvasDimensions.get(pageNum);
        if (dims) {
          const aspectRatio = dims.height / dims.width;
          // Constrain width to not exceed available space - stop growing at sidebar limit
          const constrainedWidth = Math.min(pagesZoom, availableWidth);
          const newWidth = `${constrainedWidth}px`;
          const newHeight = `${constrainedWidth * aspectRatio}px`;
          const newMaxWidth = `${availableWidth}px`;

          // Only update if dimensions actually changed
          if (canvas.style.width !== newWidth || canvas.style.height !== newHeight || canvas.style.maxWidth !== newMaxWidth) {
            canvas.style.width = newWidth;
            canvas.style.height = newHeight;
            canvas.style.maxWidth = newMaxWidth;
          }
        }
      });

      // After resizing, scroll to keep current page in view
      setTimeout(() => {
        if (currentPageThumbnailRef.current) {
          currentPageThumbnailRef.current.scrollIntoView({ behavior: 'auto', block: 'center' });
        }
      }, 0);
    }
  }, [sidebarTab, pagesZoom]);

  // Pre-render thumbnails for active note to ensure seamless transitions
  useEffect(() => {
    if (!activeNote || !pdfDoc) return;

    // Pre-render all thumbnails in the active note's page ranges
    activeNote.pageRanges.forEach(pageNum => {
      // Render for Pages view
      const pagesCanvas = thumbnailRefs.get(pageNum);
      if (pagesCanvas) {
        renderPageThumbnail(pageNum, pagesCanvas, 0.5, 1, true);
      }

      // Render for Canvas view
      const canvasCanvas = mainThumbnailRefs.get(pageNum);
      if (canvasCanvas) {
        renderPageThumbnail(pageNum, canvasCanvas, 0.25, 1, true);
      }
    });
  }, [activeNote?.id, pdfDoc]);

  // Auto-scroll when navigating via Previous/Next buttons
  useEffect(() => {
    if (!shouldAutoScroll) return;

    if (sidebarTab === 'pages') {
      // Scroll to current page in pages view
      setTimeout(() => {
        const allPages = document.querySelectorAll('.page-thumbnail');
        if (allPages.length >= currentPage) {
          allPages[currentPage - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 50);
    } else if (sidebarTab === 'canvas') {
      // Scroll to current page in canvas view
      setTimeout(() => {
        const canvasItems = canvasGridRef.current?.querySelectorAll('.canvas-item');
        if (canvasItems && canvasItems.length >= currentPage) {
          canvasItems[currentPage - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 50);
    }

    setShouldAutoScroll(false);
  }, [currentPage, shouldAutoScroll, sidebarTab]);

  // Render pages view
  const renderPagesView = () => {
    // Calculate available width for thumbnails (leave margin)
    const availableWidth = pagesSliderRef.current 
      ? pagesSliderRef.current.clientWidth - 68 
      : pagesZoom;

    return (
      <div className="pages-view">
        <div className="pages-slider" ref={pagesSliderRef} style={{ '--pages-zoom': pagesZoom } as React.CSSProperties}>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map(pageNum => {
            const dims = canvasDimensions.get(pageNum);
            // Cap width at available sidebar width
            const constrainedWidth = Math.min(pagesZoom, availableWidth);
            const displayHeight = dims 
              ? constrainedWidth * (dims.height / dims.width) 
              : 'auto';

            const isInActiveNote = activeNote ? activeNote.pageRanges.includes(pageNum) : false;
            const isGrayedOut = activeNote !== null && !isInActiveNote;

            return (
              <div
                key={pageNum}
                ref={pageNum === currentPage ? currentPageThumbnailRef : null}
                className={`page-thumbnail ${pageNum === currentPage ? 'current-page' : ''} ${selectedPages.has(pageNum) ? 'selected-page' : ''} ${isGrayedOut ? 'grayed-out' : ''}`}
                onClick={(e) => handlePageClick(pageNum, e)}
                onMouseDown={(e) => handleDragSelectionStart(pageNum, e)}
                onMouseEnter={() => handleDragSelectionMove(pageNum)}
                title={`Page ${pageNum}`}
              >
                <canvas
                  ref={setThumbnailRef(pageNum)}
                  className="page-thumbnail-canvas"
                  style={{
                    width: `${constrainedWidth}px`,
                    height: typeof displayHeight === 'number' ? `${displayHeight}px` : displayHeight,
                    maxWidth: `${availableWidth}px`
                  }}
                />
                <div className="page-thumbnail-number">{pageNum}</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // Render canvas view with very small canvases in reflowable grid
  const renderCanvasView = () => {
    // Calculate available width for thumbnails - same as Pages
    const availableWidth = canvasGridRef.current 
      ? canvasGridRef.current.clientWidth - 8 
      : canvasZoom;

    // Cap grid cell size at available width to prevent tiles growing beyond thumbnails
    const effectiveGridSize = Math.min(canvasZoom, availableWidth + 4); // +4 to account for padding

    return (
      <div className="canvas-view">
        <div className="canvas-grid" ref={canvasGridRef} style={{ '--canvas-zoom': `${effectiveGridSize}px` } as React.CSSProperties}>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map(pageNum => {
            const dims = canvasDimensions.get(pageNum);
            const aspectRatio = dims ? dims.height / dims.width : 1.414;
            const targetWidth = canvasZoom - 4;
            // Cap width at available sidebar width - same as Pages
            const constrainedWidth = Math.min(targetWidth, availableWidth);
            const targetHeight = constrainedWidth * aspectRatio;

            const isInActiveNote = activeNote ? activeNote.pageRanges.includes(pageNum) : false;
            const isGrayedOut = activeNote !== null && !isInActiveNote;

            return (
              <div
                key={pageNum}
                className={`canvas-item ${pageNum === currentPage ? 'current-page' : ''} ${selectedPages.has(pageNum) ? 'selected-page' : ''} ${isGrayedOut ? 'grayed-out' : ''}`}
                onClick={(e) => handlePageClick(pageNum, e)}
                onMouseDown={(e) => handleDragSelectionStart(pageNum, e)}
                onMouseEnter={() => handleDragSelectionMove(pageNum)}
                title={`Page ${pageNum}`}
              >
                <canvas
                  ref={setMainThumbnailRef(pageNum)}
                  className="canvas-thumbnail"
                  style={{ 
                    width: `${constrainedWidth}px`, 
                    height: `${targetHeight}px`,
                    maxWidth: `${availableWidth}px`
                  }}
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
          // Check if any of this node's pages overlap with the active note's page ranges
          const isInActiveNote = activeNote ? (() => {
            const nodePages = tocPageMap.get(nodePath);
            if (!nodePages || nodePages.length === 0) return false;
            // Check if any page in this node's range is in the active note's page ranges
            return nodePages.some(page => activeNote.pageRanges.includes(page));
          })() : false;
          const isGrayedOut = activeNote !== null && !isInActiveNote;

          return (
            <li key={index} className={`toc-item ${isGrayedOut ? 'grayed-out' : ''}`} data-toc-path={nodePath}>
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
      setShouldAutoScroll(true);
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
      setShouldAutoScroll(true);
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
    if (isParentResizing) return; // Don't allow resize when parent is resizing
    e.preventDefault();
    setIsResizing(true);
  };

  const handleResizeMove = (e: MouseEvent) => {
    if (isResizing) {
      const newWidth = e.clientX;
      const minToolbarWidth = 650;
      const minTocWidth = 415; // Accommodate Create Note + Go To + Selection buttons
      const currentRightSidebarWidth = showRightSidebar ? rightSidebarWidth : 0;
      const rightResizeHandle = showRightSidebar ? 12 : 0;
      const leftResizeHandle = 12;
      const maxTocWidth = window.innerWidth - currentRightSidebarWidth - rightResizeHandle - leftResizeHandle - minToolbarWidth;
      if (newWidth >= minTocWidth && newWidth <= maxTocWidth) {
        setTocWidth(newWidth);
      }
    }
  };

  const handleResizeEnd = () => {
    setIsResizing(false);
  };

  const handleRightResizeStart = (e: React.MouseEvent) => {
    if (isParentResizing) return; // Don't allow resize when parent is resizing
    e.preventDefault();
    setIsResizingRight(true);
  };

  const handleRightResizeMove = (e: MouseEvent) => {
    if (isResizingRight) {
      // Use availableWidth if provided (when note editor is open), otherwise use full window width
      const containerWidth = availableWidth || window.innerWidth;

      // Calculate new width based on the mouse position relative to container
      const mouseXInContainer = e.clientX - (window.innerWidth - containerWidth);
      const newWidth = containerWidth - mouseXInContainer;

      const minToolbarWidth = 650;
      const leftSidebarWidth = showToc ? tocWidth : 0;
      const leftResizeHandle = showToc ? 12 : 0;
      const rightResizeHandle = 12;
      const maxRightWidth = containerWidth - leftSidebarWidth - leftResizeHandle - rightResizeHandle - minToolbarWidth;

      if (newWidth >= 340 && newWidth <= maxRightWidth) {
        setRightSidebarWidth(newWidth);
      }
    }
  };

  const handleRightResizeEnd = () => {
    setIsResizingRight(false);
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

  useEffect(() => {
    if (isResizingRight) {
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
      document.addEventListener('mousemove', handleRightResizeMove);
      document.addEventListener('mouseup', handleRightResizeEnd);
      return () => {
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        document.removeEventListener('mousemove', handleRightResizeMove);
        document.removeEventListener('mouseup', handleRightResizeEnd);
      };
    }
  }, [isResizingRight, availableWidth, showToc, tocWidth, rightSidebarWidth]);

  return (
    <div className={`pdf-viewer-container ${isResizing || isResizingRight ? 'resizing' : ''}`}>
      {/* Table of Contents Sidebar */}
      <>
        <div className={`toc-sidebar ${!showToc ? 'hidden' : ''}`} style={{ width: `${tocWidth}px`, minWidth: '415px' }}>
            <div className="toc-toolbar">
              <div className="toc-toolbar-top">
                <button onClick={() => setShowToc(false)} className="toc-close-btn">☰</button>
                <div className="sidebar-tabs">
                  <button
                    onClick={() => setSidebarTab('toc')}
                    className={`sidebar-tab ${sidebarTab === 'toc' ? 'active' : ''}`}
                    disabled={outline.length === 0}
                    title={outline.length === 0 ? 'No table of contents available' : 'Table of contents'}
                  >
                    Table
                  </button>
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
                <button 
                  className="toc-collapse-btn" 
                  onClick={createNoteFromSelection}
                  disabled={
                    (sidebarTab === 'toc' && selectedNodes.size === 0) ||
                    ((sidebarTab === 'pages' || sidebarTab === 'canvas') && selectedPages.size === 0)
                  }
                >
                  Create Note
                </button>
                <div className="toc-dropdown" ref={gotoDropdownRef}>
                  <button
                    onClick={() => setGotoDropdownOpen(!gotoDropdownOpen)}
                    className="toc-dropdown-btn"
                  >
                    Go To {gotoDropdownOpen ? '▼' : '▶'}
                  </button>
                  {gotoDropdownOpen && (
                    <div className="toc-dropdown-menu">
                      {activeNote && (
                        <button
                          onClick={() => { goToNote(); setGotoDropdownOpen(false); }}
                          className="toc-dropdown-item"
                        >
                          Note
                        </button>
                      )}
                      <button
                        onClick={() => { goToTop(); setGotoDropdownOpen(false); }}
                        className="toc-dropdown-item"
                      >
                        Top
                      </button>
                      <button
                        onClick={() => { goToBottom(); setGotoDropdownOpen(false); }}
                        className="toc-dropdown-item"
                      >
                        Bottom
                      </button>
                    </div>
                  )}
                </div>
                {sidebarTab === 'toc' && outline.length > 0 && (
                  <div className="toc-dropdown" ref={tocDropdownRef}>
                    <button
                      onClick={() => setTreeDropdownOpen(!treeDropdownOpen)}
                      className="toc-dropdown-btn"
                    >
                      Selection {treeDropdownOpen ? '▼' : '▶'}
                    </button>
                    {treeDropdownOpen && (
                      <div className="toc-dropdown-menu">
                        {activeNote && (
                          <>
                            <button
                              onClick={() => { expandNote(); setTreeDropdownOpen(false); }}
                              className="toc-dropdown-item"
                            >
                              Expand Note
                            </button>
                            <button
                              onClick={() => { collapseNote(); setTreeDropdownOpen(false); }}
                              className="toc-dropdown-item"
                            >
                              Collapse Note
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => { expandChecked(); setTreeDropdownOpen(false); }}
                          className="toc-dropdown-item"
                          disabled={selectedNodes.size === 0}
                        >
                          Expand Checked
                        </button>
                        <button
                          onClick={() => { collapseChecked(); setTreeDropdownOpen(false); }}
                          className="toc-dropdown-item"
                          disabled={selectedNodes.size === 0}
                        >
                          Collapse Checked
                        </button>
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
                      onClick={(e) => { e.stopPropagation(); setTreeDropdownOpen(!treeDropdownOpen); }}
                      className="toc-dropdown-btn"
                    >
                      Selection {treeDropdownOpen ? '▼' : '▶'}
                    </button>
                    {treeDropdownOpen && (
                      <div className="toc-dropdown-menu">
                        <button
                          onClick={(e) => { e.stopPropagation(); selectAllPages(); setTreeDropdownOpen(false); }}
                          className="toc-dropdown-item"
                        >
                          Select All
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); clearPageSelections(); setTreeDropdownOpen(false); }}
                          className="toc-dropdown-item"
                        >
                          Deselect All
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {sidebarTab === 'canvas' && (
                  <div className="toc-dropdown" ref={pagesDropdownRef}>
                    <button
                      onClick={(e) => { e.stopPropagation(); setTreeDropdownOpen(!treeDropdownOpen); }}
                      className="toc-dropdown-btn"
                    >
                      Selection {treeDropdownOpen ? '▼' : '▶'}
                    </button>
                    {treeDropdownOpen && (
                      <div className="toc-dropdown-menu">
                        <button
                          onClick={(e) => { e.stopPropagation(); selectAllPages(); setTreeDropdownOpen(false); }}
                          className="toc-dropdown-item"
                        >
                          Select All
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); clearPageSelections(); setTreeDropdownOpen(false); }}
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
                  <label htmlFor="canvas-zoom">Size:</label>
                  <input
                    id="canvas-zoom"
                    type="range"
                    min="25"
                    max="250"
                    value={canvasZoom}
                    onChange={(e) => setCanvasZoom(Number(e.target.value))}
                    className="zoom-slider"
                  />
                  <span className="zoom-value">{canvasZoom}px</span>
                </div>
              )}
              {sidebarTab === 'pages' && (
                <div className="toc-toolbar-zoom">
                  <label htmlFor="pages-zoom">Size:</label>
                  <input
                    id="pages-zoom"
                    type="range"
                    min="50"
                    max="500"
                    value={pagesZoom}
                    onChange={(e) => setPagesZoom(Number(e.target.value))}
                    className="zoom-slider"
                  />
                  <span className="zoom-value">{pagesZoom}px</span>
                </div>
              )}
              {(sidebarTab === 'pages' || sidebarTab === 'canvas') && (
                <div className="sidebar-instructions">
                  Click to navigate • Drag to select range • Ctrl+Click to toggle selection • Shift+Click to select range • ESC to clear selection
                </div>
              )}
            </div>
            <div className="toc-content">
              <div className={`toc-tab-panel ${sidebarTab === 'toc' ? 'active' : ''}`}>
                <h3>Table of Contents</h3>
                {outline.length > 0 ? (
                  renderOutlineItems(outline)
                ) : (
                  <p style={{ padding: '20px', color: '#888', textAlign: 'center' }}>
                    {pdfDoc ? 'This PDF does not have a table of contents.' : 'No PDF loaded.'}
                  </p>
                )}
              </div>
              <div className={`toc-tab-panel ${sidebarTab === 'pages' ? 'active' : ''}`}>
                <h3>Pages ({totalPages} total)</h3>
                {totalPages > 0 && renderPagesView()}
              </div>
              <div className={`toc-tab-panel ${sidebarTab === 'canvas' ? 'active' : ''}`}>
                <h3>Canvas ({totalPages} total)</h3>
                {totalPages > 0 && renderCanvasView()}
              </div>
            </div>
          </div>
        <div 
          className={`toc-resize-handle ${!showToc ? 'hidden' : ''}`} 
          onMouseDown={handleResizeStart}
          style={{ pointerEvents: isParentResizing ? 'none' : 'auto' }}
        ></div>
      </>

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
            {!showRightSidebar && (
              <button onClick={() => setShowRightSidebar(true)} className="pdf-toolbar-toc-btn">
                ☰
              </button>
            )}
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

      {/* Right Sidebar */}
      <>
        <div 
          className={`toc-resize-handle ${!showRightSidebar ? 'hidden' : ''}`} 
          onMouseDown={handleRightResizeStart}
          style={{ pointerEvents: isParentResizing ? 'none' : 'auto' }}
        ></div>
        <div className={`toc-sidebar right-sidebar ${!showRightSidebar ? 'hidden' : ''}`} style={{ width: `${rightSidebarWidth}px` }}>
            <div className="toc-toolbar">
              <div className="toc-toolbar-top">
                <h3 style={{ margin: '0', fontSize: '14px' }}>Notes</h3>
                <button onClick={() => setShowRightSidebar(false)} className="toc-close-btn right-close-btn">☰</button>
              </div>
              {activeNote && (
                <div className="toc-toolbar-bottom">
                  <button 
                    className="toc-collapse-btn" 
                    onClick={() => setActiveNote(null)}
                  >
                    Clear Selection
                  </button>
                </div>
              )}
            </div>
            <div className="toc-content">
              {notes.length === 0 ? (
                <p style={{ padding: '20px', color: '#888', textAlign: 'center' }}>
                  No notes yet. Select TOC items and click "Create Note" to get started.
                </p>
              ) : (
                <div className="notes-list">
                  {notes.map(note => (
                    <div 
                      key={note.id} 
                      className={`note-item ${activeNote?.id === note.id ? 'active' : ''}`}
                      onClick={() => {
                        setActiveNote(note);
                        // Navigate to first page of the note
                        if (note.pageRanges.length > 0) {
                          const firstPage = Math.min(...note.pageRanges);
                          setCurrentPage(firstPage);
                        }
                      }}
                    >
                      <div className="note-header">
                        <h4>{note.title}</h4>
                        <button
                          className="note-delete-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`Delete note "${note.title}"?`)) {
                              setNotes(prev => prev.filter(n => n.id !== note.id));
                              if (activeNote?.id === note.id) {
                                setActiveNote(null);
                              }
                              // Delete from database
                              deleteNote(note.id).catch(err => {
                                console.error('Failed to delete note:', err);
                              });
                            }
                          }}
                          title="Delete note"
                        >
                          ×
                        </button>
                      </div>
                      <div className="note-info">
                        <span className="note-toc-count">{note.tocPaths.size} TOC items</span>
                        <span className="note-page-range">
                          {note.pageRanges.length > 0 ? (
                            <>Pages: {Math.min(...note.pageRanges)}-{Math.max(...note.pageRanges)}</>
                          ) : (
                            'No pages'
                          )}
                        </span>
                      </div>
                      <div className="note-date">
                        {note.createdAt.toLocaleDateString()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
      </>
    </div>
  );
}
