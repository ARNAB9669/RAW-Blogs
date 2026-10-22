// raw-blogs-script.js - Interactive features for RAW-Blogs

document.addEventListener('DOMContentLoaded', () => {
    // 1. Scrollspy for Table of Contents (TOC)
    const tocLinks = document.querySelectorAll('.sidebar-toc ol a');
    const entries = document.querySelectorAll('.entry');
    const articleStage = document.getElementById('entries') || document.querySelector('main.article-stage');

    if (tocLinks.length && entries.length) {
        const observerOptions = {
            root: articleStage || null,
            rootMargin: '-30px 0px -60% 0px',
            threshold: 0
        };

        const observer = new IntersectionObserver((observedEntries) => {
            observedEntries.forEach(observed => {
                if (observed.isIntersecting) {
                    const id = observed.target.getAttribute('id');
                    tocLinks.forEach(link => {
                        if (link.getAttribute('href') === `#${id}`) {
                            link.classList.add('active');
                            // Ensure active item is visible in TOC scrollview without scrolling the main window
                            const scrollContainer = link.closest('.toc-top-section') || link.closest('.sidebar-toc');
                            if (scrollContainer) {
                                const linkRect = link.getBoundingClientRect();
                                const containerRect = scrollContainer.getBoundingClientRect();
                                if (linkRect.top < containerRect.top || linkRect.bottom > containerRect.bottom) {
                                    scrollContainer.scrollBy({
                                        top: (linkRect.top - containerRect.top) - (containerRect.height / 2) + (linkRect.height / 2),
                                        behavior: 'smooth'
                                    });
                                }
                            }
                        } else {
                            link.classList.remove('active');
                        }
                    });
                }
            });
        }, observerOptions);

        entries.forEach(entry => observer.observe(entry));

        // Smooth click navigation on TOC links
        tocLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                const href = link.getAttribute('href');
                if (href && href.startsWith('#')) {
                    const targetEntry = document.querySelector(href);
                    if (targetEntry) {
                        e.preventDefault();
                        if (window.innerWidth <= 1024) {
                            targetEntry.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        } else if (articleStage) {
                            const targetTop = targetEntry.getBoundingClientRect().top - articleStage.getBoundingClientRect().top + articleStage.scrollTop;
                            articleStage.scrollTo({
                                top: targetTop - 24,
                                behavior: 'smooth'
                            });
                        }
                        history.pushState(null, '', href);
                    }
                }
            });
        });
    }

    // 2. Reading Progress Tracker
    const progressFill = document.getElementById('progress-fill');
    const progressPct = document.getElementById('progress-pct');

    const updateReadingProgress = () => {
        const scrollElem = articleStage || document.documentElement;
        const totalHeight = scrollElem.scrollHeight - scrollElem.clientHeight;
        if (totalHeight > 0) {
            const scrollTop = articleStage ? articleStage.scrollTop : window.scrollY;
            const scrolled = Math.min(100, Math.max(0, Math.round((scrollTop / totalHeight) * 100)));
            if (progressFill) progressFill.style.width = `${scrolled}%`;
            if (progressPct) progressPct.textContent = `${scrolled}%`;
        }
    };

    if (articleStage) {
        articleStage.addEventListener('scroll', updateReadingProgress, { passive: true });
    }
    window.addEventListener('scroll', updateReadingProgress, { passive: true });

    // 3. Search and Quick Filter Engine
    const searchInput = document.getElementById('entry-search-input');
    const clearBtn = document.getElementById('search-clear-btn');
    const dropdown = document.getElementById('search-results-dropdown');
    const noResultsEl = document.getElementById('no-search-results');
    const clearEmptyBtn = document.getElementById('btn-clear-empty');
    const tocCountBadge = document.getElementById('toc-count-badge');
    const initialTocText = tocCountBadge ? tocCountBadge.textContent : '21 Chapters';

    if (searchInput) {
        // Build searchable index from DOM
        const searchIndex = Array.from(entries).map(entry => {
            const id = entry.id;
            const titleEl = entry.querySelector('h2');
            const title = titleEl ? titleEl.textContent.trim() : '';
            const tagEl = entry.querySelector('.blog-tag');
            const tag = tagEl ? tagEl.textContent.trim() : '';
            const firstPara = entry.querySelector('p');
            const summary = firstPara ? firstPara.textContent.trim() : '';
            const fullText = (entry.textContent || '').toLowerCase();
            const tocLink = document.querySelector(`.sidebar-toc ol a[href="#${id}"]`);
            const tocLi = tocLink ? tocLink.closest('li') : null;

            return {
                id,
                title,
                tag,
                summary,
                fullText,
                entryEl: entry,
                tocLi
            };
        });

        let selectedDropdownIndex = -1;

        const escapeHtml = (str) => {
            return str
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        };

        const highlightMatch = (text, query) => {
            if (!query) return escapeHtml(text);
            const safeText = escapeHtml(text);
            const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`(${escapedQuery})`, 'gi');
            return safeText.replace(regex, '<span class="search-highlight">$1</span>');
        };

        const getSnippet = (item, query) => {
            const q = query.toLowerCase();
            // Try to find matching sentence or clause in summary or entry text
            const paragraphs = item.entryEl.querySelectorAll('p, li');
            for (const p of paragraphs) {
                const text = p.textContent.trim();
                const idx = text.toLowerCase().indexOf(q);
                if (idx !== -1) {
                    const start = Math.max(0, idx - 40);
                    const end = Math.min(text.length, idx + q.length + 60);
                    let snippet = text.slice(start, end).trim();
                    if (start > 0) snippet = '…' + snippet;
                    if (end < text.length) snippet = snippet + '…';
                    return snippet;
                }
            }
            return item.summary.slice(0, 90) + (item.summary.length > 90 ? '…' : '');
        };

        const navigateToChapter = (id) => {
            const targetEntry = document.getElementById(id);
            if (targetEntry) {
                // Ensure target is visible if hidden by search
                targetEntry.style.display = '';
                if (window.innerWidth <= 1024) {
                    targetEntry.scrollIntoView({ behavior: 'smooth', block: 'start' });
                } else if (articleStage) {
                    const targetTop = targetEntry.getBoundingClientRect().top - articleStage.getBoundingClientRect().top + articleStage.scrollTop;
                    articleStage.scrollTo({
                        top: Math.max(0, targetTop - 24),
                        behavior: 'smooth'
                    });
                }
                history.pushState(null, '', `#${id}`);

                // Visual flash animation
                targetEntry.classList.remove('search-target-highlight');
                void targetEntry.offsetWidth; // Reflow
                targetEntry.classList.add('search-target-highlight');
                setTimeout(() => targetEntry.classList.remove('search-target-highlight'), 2000);
            }
            if (dropdown) dropdown.style.display = 'none';
        };

        const updateSearch = () => {
            const query = searchInput.value.toLowerCase().trim();
            const dividers = document.querySelectorAll('.entry-divider');
            selectedDropdownIndex = -1;

            if (clearBtn) {
                clearBtn.style.display = query ? 'flex' : 'none';
            }

            if (!query) {
                // Reset everything
                searchIndex.forEach(item => {
                    item.entryEl.style.display = '';
                    if (item.tocLi) item.tocLi.style.display = '';
                });
                dividers.forEach(div => div.style.display = '');
                if (noResultsEl) noResultsEl.style.display = 'none';
                if (tocCountBadge) tocCountBadge.textContent = initialTocText;
                if (dropdown) dropdown.style.display = 'none';
                return;
            }

            // Score & filter items
            const matches = [];
            searchIndex.forEach(item => {
                const titleLower = item.title.toLowerCase();
                const tagLower = item.tag.toLowerCase();
                const textLower = item.fullText;

                let score = 0;
                if (titleLower.includes(query)) score += 100;
                if (tagLower.includes(query)) score += 70;
                if (textLower.includes(query)) score += 30;

                if (score > 0) {
                    matches.push({ item, score });
                }
            });

            matches.sort((a, b) => b.score - a.score);
            const matchedItems = matches.map(m => m.item);
            const matchedSet = new Set(matchedItems.map(m => m.id));

            // Update main article entries visibility
            searchIndex.forEach(item => {
                const isMatched = matchedSet.has(item.id);
                item.entryEl.style.display = isMatched ? '' : 'none';
                if (item.tocLi) item.tocLi.style.display = isMatched ? '' : 'none';
            });
            dividers.forEach(div => div.style.display = 'none');

            // Update TOC header badge
            if (tocCountBadge) {
                tocCountBadge.textContent = matchedItems.length === 1 
                    ? '1 Match' 
                    : `${matchedItems.length} Matches`;
            }

            // Empty state on article stage
            if (noResultsEl) {
                noResultsEl.style.display = matchedItems.length === 0 ? 'block' : 'none';
            }

            // Populate autocomplete dropdown
            if (dropdown) {
                if (matchedItems.length === 0) {
                    dropdown.innerHTML = `
                        <div class="search-dropdown-header">
                            <span>Search Results</span>
                            <span class="count">0 found</span>
                        </div>
                        <div class="search-dropdown-empty">
                            No chapters matching "<strong>${escapeHtml(query)}</strong>"
                        </div>
                    `;
                } else {
                    const topMatches = matchedItems.slice(0, 7);
                    const itemsHtml = topMatches.map((item, idx) => {
                        const highlightedTitle = highlightMatch(item.title, query);
                        const highlightedTag = highlightMatch(item.tag, query);
                        const snippet = getSnippet(item, query);
                        const highlightedSnippet = highlightMatch(snippet, query);

                        return `
                            <div class="search-result-item" data-id="${item.id}" data-index="${idx}">
                                <div class="search-result-top">
                                    <span class="search-result-title">${highlightedTitle}</span>
                                    <span class="search-result-tag">${highlightedTag}</span>
                                </div>
                                <div class="search-result-snippet">${highlightedSnippet}</div>
                            </div>
                        `;
                    }).join('');

                    dropdown.innerHTML = `
                        <div class="search-dropdown-header">
                            <span>Chapters</span>
                            <span class="count">${matchedItems.length} found</span>
                        </div>
                        <div class="search-results-list">
                            ${itemsHtml}
                        </div>
                    `;

                    // Attach click handlers to dropdown items
                    dropdown.querySelectorAll('.search-result-item').forEach(el => {
                        el.addEventListener('click', () => {
                            const id = el.getAttribute('data-id');
                            navigateToChapter(id);
                        });
                    });
                }
                dropdown.style.display = 'block';
            }
        };

        searchInput.addEventListener('input', updateSearch);

        // Re-open dropdown when focusing search input if query exists
        searchInput.addEventListener('focus', () => {
            if (searchInput.value.trim() && dropdown) {
                dropdown.style.display = 'block';
            }
        });

        // Keyboard navigation in search input
        searchInput.addEventListener('keydown', (e) => {
            if (!dropdown || dropdown.style.display === 'none') return;
            const items = dropdown.querySelectorAll('.search-result-item');
            if (!items.length) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                selectedDropdownIndex = (selectedDropdownIndex + 1) % items.length;
                items.forEach((item, i) => {
                    item.classList.toggle('selected', i === selectedDropdownIndex);
                    if (i === selectedDropdownIndex) item.scrollIntoView({ block: 'nearest' });
                });
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                selectedDropdownIndex = (selectedDropdownIndex - 1 + items.length) % items.length;
                items.forEach((item, i) => {
                    item.classList.toggle('selected', i === selectedDropdownIndex);
                    if (i === selectedDropdownIndex) item.scrollIntoView({ block: 'nearest' });
                });
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (selectedDropdownIndex >= 0 && items[selectedDropdownIndex]) {
                    const id = items[selectedDropdownIndex].getAttribute('data-id');
                    navigateToChapter(id);
                } else if (items[0]) {
                    const id = items[0].getAttribute('data-id');
                    navigateToChapter(id);
                }
            } else if (e.key === 'Escape') {
                dropdown.style.display = 'none';
                searchInput.blur();
            }
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.search-wrapper')) {
                if (dropdown) dropdown.style.display = 'none';
            }
        });

        // Clear button handler
        if (clearBtn) {
            clearBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                searchInput.value = '';
                searchInput.focus();
                updateSearch();
            });
        }

        // Empty state clear button
        if (clearEmptyBtn) {
            clearEmptyBtn.addEventListener('click', () => {
                searchInput.value = '';
                updateSearch();
            });
        }

        // ⌘K / Ctrl+K keyboard shortcut to focus search
        window.addEventListener('keydown', (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                searchInput.focus();
                searchInput.select();
                if (searchInput.value.trim() && dropdown) {
                    dropdown.style.display = 'block';
                }
            }
        });
    }

    // 4. Video Lazy Loading with IntersectionObserver
    const lazyVideos = document.querySelectorAll('video[data-lazy-video]');
    if (lazyVideos.length && 'IntersectionObserver' in window) {
        const videoObserver = new IntersectionObserver((observedVideos, observer) => {
            observedVideos.forEach(entry => {
                if (entry.isIntersecting) {
                    const video = entry.target;
                    const sources = video.querySelectorAll('source[data-src]');
                    sources.forEach(source => {
                        source.src = source.getAttribute('data-src');
                        source.removeAttribute('data-src');
                    });
                    video.load();
                    video.removeAttribute('data-lazy-video');
                    observer.unobserve(video);
                }
            });
        }, {
            root: articleStage || null,
            rootMargin: '400px 0px 400px 0px',
            threshold: 0
        });

        lazyVideos.forEach(video => videoObserver.observe(video));
    }

    // 5. Video auto-pause mutual exclusivity
    const allVideos = document.querySelectorAll('.entry-media video');
    allVideos.forEach(video => {
        video.addEventListener('play', () => {
            allVideos.forEach(otherVideo => {
                if (otherVideo !== video && !otherVideo.paused) {
                    otherVideo.pause();
                }
            });
        });
    });

    // 5. Utility button handlers
    const copyLinkBtn = document.getElementById('btn-copy-link');
    if (copyLinkBtn) {
        copyLinkBtn.addEventListener('click', async () => {
            const original = copyLinkBtn.innerHTML;
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(window.location.href);
                } else {
                    throw new Error('Clipboard API unavailable');
                }
            } catch (e) {
                const temp = document.createElement('input');
                temp.value = window.location.href;
                document.body.appendChild(temp);
                temp.select();
                document.execCommand('copy');
                document.body.removeChild(temp);
            }
            copyLinkBtn.innerHTML = '✓ Link Copied!';
            copyLinkBtn.classList.add('copied');
            setTimeout(() => {
                copyLinkBtn.innerHTML = original;
                copyLinkBtn.classList.remove('copied');
            }, 1800);
        });
    }


    // 6. Light Mode Meme Popup ("We don't do that here")
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    const lightModal = document.getElementById('light-mode-modal');
    const modalCloseBtn = document.getElementById('modal-close-btn');
    const modalBackdrop = lightModal ? lightModal.querySelector('.modal-backdrop') : null;

    if (themeToggleBtn && lightModal) {
        // Ensure no data-theme="light" persists so the site stays in native dark mode
        document.documentElement.removeAttribute('data-theme');
        try {
            localStorage.removeItem('raw-blog-theme');
        } catch (e) {}

        const openModal = () => {
            lightModal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
        };

        const closeModal = () => {
            lightModal.style.display = 'none';
            document.body.style.overflow = '';
        };

        themeToggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            openModal();
        });

        if (modalCloseBtn) {
            modalCloseBtn.addEventListener('click', closeModal);
        }

        if (modalBackdrop) {
            modalBackdrop.addEventListener('click', closeModal);
        }

        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && lightModal.style.display !== 'none') {
                closeModal();
            }
        });
    }
});
