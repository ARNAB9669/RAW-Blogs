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
                            // Ensure active item is visible in sidebar scrollview without scrolling the main window
                            const sidebar = link.closest('.sidebar-toc');
                            if (sidebar) {
                                const linkRect = link.getBoundingClientRect();
                                const sidebarRect = sidebar.getBoundingClientRect();
                                if (linkRect.top < sidebarRect.top || linkRect.bottom > sidebarRect.bottom) {
                                    sidebar.scrollBy({
                                        top: (linkRect.top - sidebarRect.top) - (sidebarRect.height / 2) + (linkRect.height / 2),
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
                    if (targetEntry && articleStage) {
                        e.preventDefault();
                        const targetTop = targetEntry.getBoundingClientRect().top - articleStage.getBoundingClientRect().top + articleStage.scrollTop;
                        articleStage.scrollTo({
                            top: targetTop - 24,
                            behavior: 'smooth'
                        });
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

    // 3. Search and Quick Filter
    const searchInput = document.getElementById('entry-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            const entryElements = document.querySelectorAll('.entry');
            const dividers = document.querySelectorAll('.entry-divider');

            entryElements.forEach(entry => {
                const text = entry.textContent.toLowerCase();
                const matches = !query || text.includes(query);
                entry.style.display = matches ? '' : 'none';
            });

            dividers.forEach(div => {
                div.style.display = query ? 'none' : '';
            });

            if (query && articleStage) {
                articleStage.scrollTop = 0;
            }
        });

        // ⌘K / Ctrl+K keyboard shortcut to focus search
        window.addEventListener('keydown', (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                searchInput.focus();
                searchInput.select();
            }
        });
    }

    // 4. Video auto-pause mutual exclusivity
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
        copyLinkBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(window.location.href);
            const original = copyLinkBtn.innerHTML;
            copyLinkBtn.innerHTML = '✓ Copied!';
            setTimeout(() => { copyLinkBtn.innerHTML = original; }, 1800);
        });
    }

    const bookmarkBtn = document.getElementById('btn-bookmark');
    if (bookmarkBtn) {
        bookmarkBtn.addEventListener('click', () => {
            const original = bookmarkBtn.innerHTML;
            bookmarkBtn.innerHTML = '★ Saved';
            setTimeout(() => { bookmarkBtn.innerHTML = original; }, 1800);
        });
    }
});
