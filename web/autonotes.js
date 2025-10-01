import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

class AutoNotesManager {
    constructor() {
        this.sidebar = null;
        // Load last display mode from localStorage, default to "all"
        this.displayMode = localStorage.getItem('autonotes_displayMode') || "all";
        this.notes = [];
        this.folders = [];
        this.editDialog = null;
        this.selectedNodeType = null;
        this.selectedNodeAttributes = {};
        this.workflowName = "";
        this.nodeTypes = {}; // Store node types and their definitions
        this.expandedFolders = new Set(); // Track which folders are expanded
        this.expandedNotes = new Set(); // Track which notes are expanded
        this.lastSelectedNodeType = null; // Track last selected node to detect changes

        this.init();
    }

    async init() {
        // Wait for app to be ready
        await new Promise(resolve => {
            if (app.canvas) {
                resolve();
            } else {
                app.registerExtension({
                    name: "AutoNotes.Init",
                    setup() {
                        resolve();
                    }
                });
            }
        });

        // Load marked library
        await this.loadMarkedLibrary();

        // Load node definitions
        await this.loadNodeTypes();

        this.createSidebar();
        this.setupEventListeners();
        await this.refreshNotes();
    }

    async loadMarkedLibrary() {
        // Load the marked library using script tag since it's UMD format
        if (typeof window.marked !== 'undefined') {
            this.marked = window.marked;
            return;
        }

        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = '/extensions/ComfyUI-AutoNotes/marked.min.js';
            script.onload = () => {
                this.marked = window.marked;
                resolve();
            };
            script.onerror = () => {
                console.error('Failed to load marked library');
                this.marked = null;
                resolve(); // Resolve anyway, will use fallback
            };
            document.head.appendChild(script);
        });
    }

    async loadNodeTypes() {
        try {
            const response = await api.fetchApi('/object_info');
            this.nodeTypes = await response.json();
        } catch (error) {
            console.error('Failed to load node types:', error);
            this.nodeTypes = {};
        }
    }

    createSidebar() {
        // Load saved width from localStorage
        const savedWidth = localStorage.getItem('autonotes_sidebarWidth') || '300';

        // Calculate top bar height dynamically
        const calculateTopBarHeight = () => {
            // Check if user has manually set a value in localStorage
            const manualHeight = localStorage.getItem('autonotes_topBarHeight');
            if (manualHeight) {
                const height = parseInt(manualHeight);
                console.log('AutoNotes: Using manually configured top bar height:', height);
                return height;
            }

            // Look for ComfyUI's main menu bar that contains buttons like Manager, Queue, etc.
            const allElements = document.querySelectorAll('*');
            let candidates = [];

            for (const el of allElements) {
                const style = window.getComputedStyle(el);
                const position = style.position;

                if (position === 'fixed' || position === 'absolute') {
                    const rect = el.getBoundingClientRect();
                    // Look for elements near the top that are reasonably wide (likely to be top bars)
                    // Relaxed criteria: width > 300 instead of 500
                    if (rect.top >= 0 && rect.top <= 100 && rect.width > 300 && rect.bottom < 250 && rect.bottom > 50) {
                        candidates.push({ bottom: rect.bottom, width: rect.width, element: el.tagName });
                    }
                }
            }

            // Sort by bottom position
            if (candidates.length > 0) {
                candidates.sort((a, b) => b.bottom - a.bottom);
                const topBarBottom = Math.ceil(candidates[0].bottom);
                console.log('AutoNotes: Detected top bar height:', topBarBottom, 'from', candidates[0].element, 'candidates:', candidates.length);
                console.log('AutoNotes: To manually override, set: localStorage.setItem("autonotes_topBarHeight", "YOUR_VALUE")');
                return topBarBottom;
            }

            // Fallback - use a reasonable default that's close to the top bar
            console.log('AutoNotes: Using fallback top bar height: 140 (no candidates found)');
            console.log('AutoNotes: To manually override, set: localStorage.setItem("autonotes_topBarHeight", "YOUR_VALUE")');
            return 140;
        };

        const topBarHeight = calculateTopBarHeight();

        // Create sidebar container - full height with padding at top
        this.sidebar = document.createElement('div');
        this.sidebar.id = 'autonotes-sidebar';
        this.sidebar.style.cssText = `
            position: fixed;
            right: 0;
            top: 0;
            width: ${savedWidth}px;
            height: 100vh;
            background: #2a2a2a;
            border-left: 1px solid #555;
            z-index: 1000;
            display: flex;
            flex-direction: column;
            padding: ${topBarHeight}px 10px 10px 10px;
            box-sizing: border-box;
            font-family: Arial, sans-serif;
            color: #fff;
        `;

        // Create resize handle
        const resizeHandle = document.createElement('div');
        resizeHandle.style.cssText = `
            position: absolute;
            left: 0;
            top: 0;
            width: 5px;
            height: 100%;
            cursor: ew-resize;
            background: transparent;
            z-index: 1001;
        `;

        resizeHandle.addEventListener('mouseenter', () => {
            resizeHandle.style.background = '#007acc';
        });

        resizeHandle.addEventListener('mouseleave', () => {
            if (!this.isResizing) {
                resizeHandle.style.background = 'transparent';
            }
        });

        // Resize functionality
        this.isResizing = false;
        let startX, startWidth;

        resizeHandle.addEventListener('mousedown', (e) => {
            this.isResizing = true;
            startX = e.clientX;
            startWidth = parseInt(this.sidebar.style.width);
            resizeHandle.style.background = '#007acc';
            document.body.style.cursor = 'ew-resize';
            document.body.style.userSelect = 'none';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!this.isResizing) return;

            const dx = startX - e.clientX;
            const newWidth = Math.max(200, Math.min(800, startWidth + dx));
            this.sidebar.style.width = newWidth + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (this.isResizing) {
                this.isResizing = false;
                resizeHandle.style.background = 'transparent';
                document.body.style.cursor = '';
                document.body.style.userSelect = '';

                // Save width to localStorage
                localStorage.setItem('autonotes_sidebarWidth', parseInt(this.sidebar.style.width));
            }
        });

        this.sidebar.appendChild(resizeHandle);

        // Control panel
        const controlPanel = document.createElement('div');
        controlPanel.style.cssText = `
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 1px solid #555;
        `;

        // Display mode selector
        const modeContainer = document.createElement('div');
        modeContainer.style.marginBottom = '10px';

        const modeLabel = document.createElement('label');
        modeLabel.textContent = 'Display: ';
        modeLabel.style.marginRight = '10px';

        const modeSelect = document.createElement('select');
        modeSelect.style.cssText = `
            background: #333;
            color: #fff;
            border: 1px solid #555;
            padding: 5px;
        `;
        modeSelect.innerHTML = `
            <option value="all">All</option>
            <option value="automatic">Automatic</option>
        `;
        modeSelect.value = this.displayMode;
        modeSelect.addEventListener('change', (e) => {
            this.displayMode = e.target.value;
            localStorage.setItem('autonotes_displayMode', this.displayMode);
            this.refreshNotes();
        });

        modeContainer.appendChild(modeLabel);
        modeContainer.appendChild(modeSelect);

        // Tag filter section
        const tagFilterContainer = document.createElement('div');
        tagFilterContainer.style.marginBottom = '10px';

        const tagFilterLabel = document.createElement('label');
        tagFilterLabel.textContent = 'Filter by Tags: ';
        tagFilterLabel.style.cssText = `
            display: block;
            margin-bottom: 5px;
        `;

        this.tagFilterSelect = document.createElement('div');
        this.tagFilterSelect.style.cssText = `
            background: #333;
            border: 1px solid #555;
            padding: 5px;
            border-radius: 4px;
            min-height: 30px;
            cursor: pointer;
            position: relative;
        `;
        this.tagFilterSelect.textContent = 'Click to select tags...';

        this.selectedTagFilters = new Set();

        this.tagFilterSelect.addEventListener('click', (e) => {
            e.stopPropagation();
            this.showTagFilterDropdown();
        });

        tagFilterContainer.appendChild(tagFilterLabel);
        tagFilterContainer.appendChild(this.tagFilterSelect);

        // Buttons
        const buttonContainer = document.createElement('div');
        buttonContainer.style.display = 'flex';
        buttonContainer.style.gap = '10px';
        buttonContainer.style.flexWrap = 'wrap';

        const addButton = document.createElement('button');
        addButton.textContent = 'Add';
        addButton.style.cssText = `
            background: #007acc;
            color: white;
            border: none;
            padding: 8px 16px;
            cursor: pointer;
            border-radius: 4px;
        `;
        addButton.addEventListener('click', () => this.addNote());

        const addFromCurrentButton = document.createElement('button');
        addFromCurrentButton.textContent = 'Add From Current Node';
        addFromCurrentButton.style.cssText = `
            background: #00a000;
            color: white;
            border: none;
            padding: 8px 16px;
            cursor: pointer;
            border-radius: 4px;
            flex: 1;
        `;
        addFromCurrentButton.addEventListener('click', () => this.addNoteFromCurrentNode());

        const editButton = document.createElement('button');
        editButton.textContent = 'Edit';
        editButton.style.cssText = `
            background: #666;
            color: white;
            border: none;
            padding: 8px 16px;
            cursor: pointer;
            border-radius: 4px;
        `;
        editButton.addEventListener('click', () => this.openEditDialog());

        buttonContainer.appendChild(addButton);
        buttonContainer.appendChild(addFromCurrentButton);
        buttonContainer.appendChild(editButton);

        controlPanel.appendChild(modeContainer);
        controlPanel.appendChild(tagFilterContainer);
        controlPanel.appendChild(buttonContainer);

        // Notes display area
        this.notesContainer = document.createElement('div');
        this.notesContainer.style.cssText = `
            flex: 1;
            overflow-y: auto;
            padding-right: 5px;
        `;

        this.sidebar.appendChild(controlPanel);
        this.sidebar.appendChild(this.notesContainer);

        document.body.appendChild(this.sidebar);
    }

    setupEventListeners() {
        // Use polling to check for selection changes (more reliable)
        this.lastSelectionCheck = null;
        setInterval(() => {
            if (app.canvas && app.canvas.selected_nodes) {
                const selectedNodeIds = Object.keys(app.canvas.selected_nodes);
                const currentSelection = selectedNodeIds.join(',');

                // Only update if selection changed
                if (currentSelection !== this.lastSelectionCheck) {
                    this.lastSelectionCheck = currentSelection;
                    this.updateSelectedNode();
                }
            }
        }, 300); // Check every 300ms

        // Listen for workflow changes
        api.addEventListener("graphChanged", () => {
            this.updateWorkflowName();
        });
    }

    updateSelectedNode() {
        // Try multiple methods to get selected nodes
        let selectedNodes = app.canvas?.selected_nodes;

        // Alternative: check graph canvas
        if (!selectedNodes && app.graph?.list_of_graphcanvas?.[0]) {
            selectedNodes = app.graph.list_of_graphcanvas[0].selected_nodes;
        }

        let currentNodeType = null;

        // Check if it's an object with keys (not a Set)
        const selectedNodeIds = selectedNodes ? Object.keys(selectedNodes) : [];

        if (selectedNodeIds.length > 0) {
            // Get the first selected node
            const nodeId = selectedNodeIds[0];
            const node = selectedNodes[nodeId];

            if (node && node.type) {
                currentNodeType = node.type;
                this.selectedNodeType = node.type;

                // Collect node attributes (widgets/inputs)
                this.selectedNodeAttributes = {};
                if (node.widgets) {
                    for (const widget of node.widgets) {
                        this.selectedNodeAttributes[widget.name] = widget.value;
                    }
                }
            }
        } else {
            this.selectedNodeType = null;
            this.selectedNodeAttributes = {};
        }

        // Only refresh if selection changed and in automatic mode
        if (this.displayMode === "automatic" && currentNodeType !== this.lastSelectedNodeType) {
            this.lastSelectedNodeType = currentNodeType;
            this.refreshNotes();
        }
    }

    updateWorkflowName() {
        // Try to get workflow name from various sources
        this.workflowName = app.ui.lastQueueSize || document.title || "";

        if (this.displayMode === "automatic") {
            this.refreshNotes();
        }
    }

    async refreshNotes() {
        try {
            const params = new URLSearchParams({
                mode: this.displayMode
            });

            if (this.selectedNodeType) {
                params.append('node_type', this.selectedNodeType);
            }

            if (Object.keys(this.selectedNodeAttributes).length > 0) {
                params.append('node_attributes', JSON.stringify(this.selectedNodeAttributes));
            }

            if (this.workflowName) {
                params.append('workflow_name', this.workflowName);
            }

            // Collect workflow node information for node_in_workflow and attribute_in_workflow triggers
            const workflowNodes = {};
            if (app.graph && app.graph._nodes) {
                for (const node of app.graph._nodes) {
                    // For each node type in workflow, collect first instance's attributes
                    if (!workflowNodes[node.type]) {
                        const attributes = {};
                        if (node.properties) {
                            Object.assign(attributes, node.properties);
                        }
                        if (node.widgets) {
                            for (const widget of node.widgets) {
                                attributes[widget.name] = widget.value;
                            }
                        }
                        workflowNodes[node.type] = attributes;
                    }
                }
            }

            if (Object.keys(workflowNodes).length > 0) {
                params.append('workflow_nodes', JSON.stringify(workflowNodes));
            }

            const response = await api.fetchApi(`/autonotes/notes?${params}`);
            this.notes = await response.json();
            this.renderNotes();
        } catch (error) {
            console.error('Failed to fetch notes:', error);
        }
    }

    renderNotes() {
        this.notesContainer.innerHTML = '';

        // Apply tag filtering
        let filteredNotes = this.notes;
        if (this.selectedTagFilters.size > 0) {
            filteredNotes = this.notes.filter(note => {
                const noteTags = note.tags || [];
                // Note must have ALL selected tags (AND logic)
                return Array.from(this.selectedTagFilters).every(filterTag =>
                    noteTags.includes(filterTag)
                );
            });
        }

        if (filteredNotes.length === 0) {
            const emptyMessage = document.createElement('div');
            emptyMessage.textContent = this.selectedTagFilters.size > 0 ?
                'No notes match the selected tags' : 'No notes to display';
            emptyMessage.style.cssText = `
                text-align: center;
                color: #888;
                font-style: italic;
                margin-top: 20px;
            `;
            this.notesContainer.appendChild(emptyMessage);
            return;
        }

        for (const note of filteredNotes) {
            this.renderNote(note);
        }
    }

    showTagFilterDropdown() {
        // Collect all unique tags from all notes
        const allTags = new Set();
        for (const note of this.notes) {
            if (note.tags) {
                note.tags.forEach(tag => allTags.add(tag));
            }
        }

        if (allTags.size === 0) {
            alert('No tags found. Add tags to notes first.');
            return;
        }

        // Remove existing dropdown
        const existingDropdown = document.querySelector('.tag-filter-dropdown');
        if (existingDropdown) {
            existingDropdown.remove();
            return;
        }

        // Create dropdown
        const dropdown = document.createElement('div');
        dropdown.className = 'tag-filter-dropdown';
        dropdown.style.cssText = `
            position: absolute;
            top: 100%;
            left: 0;
            right: 0;
            background: #2a2a2a;
            border: 1px solid #555;
            border-radius: 4px;
            margin-top: 2px;
            max-height: 200px;
            overflow-y: auto;
            z-index: 1000;
        `;

        // Add "Clear All" option
        const clearOption = document.createElement('div');
        clearOption.textContent = 'Clear All Filters';
        clearOption.style.cssText = `
            padding: 8px 10px;
            cursor: pointer;
            color: #f88;
            border-bottom: 1px solid #555;
        `;
        clearOption.addEventListener('mouseenter', () => {
            clearOption.style.background = '#333';
        });
        clearOption.addEventListener('mouseleave', () => {
            clearOption.style.background = '';
        });
        clearOption.addEventListener('click', () => {
            this.selectedTagFilters.clear();
            this.updateTagFilterDisplay();
            this.refreshNotes();
            dropdown.remove();
        });
        dropdown.appendChild(clearOption);

        // Add tag options
        Array.from(allTags).sort().forEach(tag => {
            const option = document.createElement('div');
            option.style.cssText = `
                padding: 8px 10px;
                cursor: pointer;
                display: flex;
                align-items: center;
                gap: 8px;
            `;

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = this.selectedTagFilters.has(tag);

            const label = document.createElement('span');
            label.textContent = tag;

            option.addEventListener('mouseenter', () => {
                option.style.background = '#333';
            });
            option.addEventListener('mouseleave', () => {
                option.style.background = '';
            });
            option.addEventListener('click', () => {
                if (this.selectedTagFilters.has(tag)) {
                    this.selectedTagFilters.delete(tag);
                    checkbox.checked = false;
                } else {
                    this.selectedTagFilters.add(tag);
                    checkbox.checked = true;
                }
                this.updateTagFilterDisplay();
                this.refreshNotes();
            });

            option.appendChild(checkbox);
            option.appendChild(label);
            dropdown.appendChild(option);
        });

        this.tagFilterSelect.style.position = 'relative';
        this.tagFilterSelect.appendChild(dropdown);

        // Close dropdown when clicking outside
        const closeDropdown = (e) => {
            if (!this.tagFilterSelect.contains(e.target)) {
                dropdown.remove();
                document.removeEventListener('click', closeDropdown);
            }
        };
        setTimeout(() => {
            document.addEventListener('click', closeDropdown);
        }, 0);
    }

    updateTagFilterDisplay() {
        if (this.selectedTagFilters.size === 0) {
            this.tagFilterSelect.innerHTML = 'Click to select tags...';
            this.tagFilterSelect.style.color = '';
        } else {
            this.tagFilterSelect.innerHTML = '';
            this.tagFilterSelect.style.color = '#fff';
            this.tagFilterSelect.style.cssText += `
                display: flex;
                flex-wrap: wrap;
                gap: 5px;
            `;

            Array.from(this.selectedTagFilters).forEach(tag => {
                const tagBadge = document.createElement('span');
                tagBadge.style.cssText = `
                    background: #007acc;
                    padding: 2px 6px;
                    border-radius: 3px;
                    font-size: 11px;
                    display: inline-block;
                `;
                tagBadge.textContent = tag;
                this.tagFilterSelect.appendChild(tagBadge);
            });

            // Re-add base styles
            this.tagFilterSelect.style.background = '#333';
            this.tagFilterSelect.style.border = '1px solid #555';
            this.tagFilterSelect.style.padding = '5px';
            this.tagFilterSelect.style.borderRadius = '4px';
            this.tagFilterSelect.style.minHeight = '30px';
            this.tagFilterSelect.style.cursor = 'pointer';
            this.tagFilterSelect.style.position = 'relative';
        }
    }

    renderNote(note) {
        const noteElement = document.createElement('div');
        noteElement.style.cssText = `
            margin-bottom: 15px;
            border: 1px solid #555;
            border-radius: 4px;
            overflow: hidden;
        `;

        // Note header (collapsible)
        const header = document.createElement('div');
        header.style.cssText = `
            background: #333;
            padding: 10px;
            cursor: pointer;
            display: flex;
            justify-content: space-between;
            align-items: center;
        `;

        const title = document.createElement('span');
        title.textContent = note.name || 'Untitled Note';
        title.style.fontWeight = 'bold';

        const controls = document.createElement('div');
        controls.style.display = 'flex';
        controls.style.gap = '5px';
        controls.style.alignItems = 'center';

        // Pin button
        const pinButton = document.createElement('button');
        pinButton.textContent = note.pinned ? '📌' : '📍';
        pinButton.title = note.pinned ? 'Unpin' : 'Pin';
        pinButton.style.cssText = `
            background: transparent;
            border: none;
            color: #fff;
            cursor: pointer;
            padding: 0;
            font-size: 16px;
            opacity: ${note.pinned ? '1' : '0.5'};
        `;
        pinButton.addEventListener('click', async (e) => {
            e.stopPropagation();
            await this.togglePin(note);
        });
        controls.appendChild(pinButton);

        // Collapse indicator
        const collapseIcon = document.createElement('span');
        collapseIcon.textContent = '▼';
        collapseIcon.style.transition = 'transform 0.2s';
        controls.appendChild(collapseIcon);

        header.appendChild(title);
        header.appendChild(controls);

        // Content container
        const contentContainer = document.createElement('div');
        contentContainer.style.cssText = `
            background: #2a2a2a;
            border-top: 1px solid #555;
        `;

        // Tags section (at the top)
        const tagsSection = document.createElement('div');
        tagsSection.style.cssText = `
            padding: 10px;
            border-bottom: 1px solid #555;
            background: #252525;
        `;

        const tagsHeader = document.createElement('div');
        tagsHeader.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 5px;
        `;

        const tagsLabel = document.createElement('span');
        tagsLabel.textContent = 'Tags:';
        tagsLabel.style.cssText = `
            font-size: 11px;
            color: #aaa;
        `;

        const addTagBtn = document.createElement('button');
        addTagBtn.textContent = '+ Tag';
        addTagBtn.style.cssText = `
            background: #007acc;
            color: white;
            border: none;
            padding: 2px 6px;
            cursor: pointer;
            border-radius: 3px;
            font-size: 10px;
        `;
        addTagBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const tag = prompt('Enter tag name:');
            if (tag && tag.trim()) {
                const trimmedTag = tag.trim();
                if (!note.tags) note.tags = [];
                if (!note.tags.includes(trimmedTag)) {
                    note.tags.push(trimmedTag);
                    await this.updateNoteTags(note);
                    this.renderNotes();
                }
            }
        });

        tagsHeader.appendChild(tagsLabel);
        tagsHeader.appendChild(addTagBtn);

        const tagsContainer = document.createElement('div');
        tagsContainer.style.cssText = `
            display: flex;
            flex-wrap: wrap;
            gap: 5px;
            min-height: 20px;
        `;

        if (note.tags && note.tags.length > 0) {
            note.tags.forEach(tag => {
                const tagBadge = document.createElement('div');
                tagBadge.style.cssText = `
                    background: #007acc;
                    color: white;
                    padding: 3px 6px;
                    border-radius: 3px;
                    font-size: 11px;
                    display: flex;
                    align-items: center;
                    gap: 4px;
                `;

                const tagText = document.createElement('span');
                tagText.textContent = tag;

                const removeBtn = document.createElement('button');
                removeBtn.textContent = '×';
                removeBtn.style.cssText = `
                    background: transparent;
                    border: none;
                    color: white;
                    cursor: pointer;
                    font-size: 14px;
                    padding: 0;
                    line-height: 1;
                `;
                removeBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    note.tags = note.tags.filter(t => t !== tag);
                    await this.updateNoteTags(note);
                    this.renderNotes();
                });

                tagBadge.appendChild(tagText);
                tagBadge.appendChild(removeBtn);
                tagsContainer.appendChild(tagBadge);
            });
        } else {
            const noTags = document.createElement('span');
            noTags.textContent = 'No tags';
            noTags.style.cssText = `
                font-size: 11px;
                color: #666;
                font-style: italic;
            `;
            tagsContainer.appendChild(noTags);
        }

        tagsSection.appendChild(tagsHeader);
        tagsSection.appendChild(tagsContainer);
        contentContainer.appendChild(tagsSection);

        // Mode toggle (for markdown notes)
        let isEditMode = false;
        let modeToggle = null;

        if (note.format_style === 'markdown') {
            const toggleBar = document.createElement('div');
            toggleBar.style.cssText = `
                padding: 5px 10px;
                background: #252525;
                border-bottom: 1px solid #555;
                display: flex;
                gap: 5px;
            `;

            const viewBtn = document.createElement('button');
            viewBtn.textContent = 'View';
            viewBtn.style.cssText = `
                background: #007acc;
                color: white;
                border: none;
                padding: 3px 10px;
                cursor: pointer;
                border-radius: 3px;
                font-size: 11px;
            `;

            const editBtn = document.createElement('button');
            editBtn.textContent = 'Edit';
            editBtn.style.cssText = `
                background: #555;
                color: white;
                border: none;
                padding: 3px 10px;
                cursor: pointer;
                border-radius: 3px;
                font-size: 11px;
            `;

            toggleBar.appendChild(viewBtn);
            toggleBar.appendChild(editBtn);
            contentContainer.appendChild(toggleBar);

            modeToggle = { viewBtn, editBtn };
        }

        // View content (rendered markdown or plain text) - resizable
        const viewContent = document.createElement('div');
        viewContent.style.cssText = `
            padding: 10px;
            min-height: 50px;
            max-height: none;
            overflow-y: auto;
            position: relative;
            resize: vertical;
        `;

        if (note.format_style === 'markdown') {
            viewContent.innerHTML = this.renderMarkdown(note.content);
        } else {
            viewContent.textContent = note.content;
            viewContent.style.whiteSpace = 'pre-wrap';
        }

        // Edit content (textarea)
        const editContent = document.createElement('textarea');
        editContent.value = note.content;
        editContent.style.cssText = `
            width: 100%;
            min-height: 100px;
            padding: 10px;
            background: #1a1a1a;
            color: #fff;
            border: none;
            font-family: monospace;
            font-size: 12px;
            resize: vertical;
            box-sizing: border-box;
            display: none;
        `;

        // Save button
        const saveBtn = document.createElement('button');
        saveBtn.textContent = 'Save';
        saveBtn.style.cssText = `
            margin: 5px 10px 10px 10px;
            background: #007acc;
            color: white;
            border: none;
            padding: 5px 15px;
            cursor: pointer;
            border-radius: 3px;
            display: none;
        `;

        // Auto-save function
        const autoSave = async () => {
            await this.updateNoteContent(note.uuid, editContent.value);
            note.content = editContent.value;
            // Update view content
            if (note.format_style === 'markdown') {
                viewContent.innerHTML = this.renderMarkdown(note.content);
            } else {
                viewContent.textContent = note.content;
            }
        };

        saveBtn.addEventListener('click', async () => {
            await autoSave();
        });

        // Auto-save when clicking off the textarea
        editContent.addEventListener('blur', async () => {
            // Only auto-save if content has changed
            if (editContent.value !== note.content) {
                await autoSave();
            }
        });

        contentContainer.appendChild(viewContent);
        contentContainer.appendChild(editContent);
        contentContainer.appendChild(saveBtn);

        // Toggle between view and edit mode
        if (modeToggle) {
            const switchToView = async () => {
                // Auto-save before switching to view
                if (isEditMode && editContent.value !== note.content) {
                    await autoSave();
                }
                // Copy the current height from editContent to viewContent
                const currentHeight = editContent.offsetHeight;
                if (currentHeight > 0) {
                    viewContent.style.height = currentHeight + 'px';
                }
                isEditMode = false;
                viewContent.style.display = 'block';
                editContent.style.display = 'none';
                saveBtn.style.display = 'none';
                modeToggle.viewBtn.style.background = '#007acc';
                modeToggle.editBtn.style.background = '#555';
            };

            const switchToEdit = () => {
                isEditMode = true;
                // Copy the current height from viewContent to editContent
                const currentHeight = viewContent.offsetHeight;
                if (currentHeight > 0) {
                    editContent.style.height = currentHeight + 'px';
                }
                viewContent.style.display = 'none';
                editContent.style.display = 'block';
                saveBtn.style.display = 'block';
                modeToggle.viewBtn.style.background = '#555';
                modeToggle.editBtn.style.background = '#007acc';
            };

            modeToggle.viewBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await switchToView();
            });

            modeToggle.editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                switchToEdit();
            });
        } else {
            // For plain text, click to edit directly
            viewContent.addEventListener('click', (e) => {
                e.stopPropagation();
                // Copy the current height from viewContent to editContent
                const currentHeight = viewContent.offsetHeight;
                if (currentHeight > 0) {
                    editContent.style.height = currentHeight + 'px';
                }
                viewContent.style.display = 'none';
                editContent.style.display = 'block';
                saveBtn.style.display = 'block';
                editContent.focus();
            });
        }

        // Collapsible functionality - restore previous state
        const isExpanded = this.expandedNotes.has(note.uuid);
        let isCollapsed = !isExpanded;

        // Set initial state
        contentContainer.style.display = isCollapsed ? 'none' : 'block';
        collapseIcon.style.transform = isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)';

        header.addEventListener('click', () => {
            isCollapsed = !isCollapsed;
            contentContainer.style.display = isCollapsed ? 'none' : 'block';
            collapseIcon.style.transform = isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)';

            // Update tracking state
            if (isCollapsed) {
                this.expandedNotes.delete(note.uuid);
            } else {
                this.expandedNotes.add(note.uuid);
            }
        });

        // Context menu for sidebar notes
        noteElement.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showSidebarNoteContextMenu(e, note);
        });

        noteElement.appendChild(header);
        noteElement.appendChild(contentContainer);
        this.notesContainer.appendChild(noteElement);
    }

    renderMarkdown(text) {
        if (!text) return '';

        // Use the bundled marked library if available
        if (this.marked) {
            try {
                return this.marked.parse(text, {
                    breaks: true,
                    gfm: true
                });
            } catch (error) {
                console.error('Markdown rendering error:', error);
            }
        }

        // Fallback to plain text with line breaks
        return text.replace(/\n/g, '<br>');
    }

    async addNote() {
        // Load folders first if not already loaded
        await this.loadFolders();

        // Show custom dialog to get note name and folder
        const result = await this.showAddNoteDialog();
        if (!result) return;

        try {
            const response = await api.fetchApi('/autonotes/notes', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    name: result.name,
                    folder_uuid: result.folder_uuid
                }),
            });

            const noteResult = await response.json();
            if (noteResult.uuid) {
                await this.refreshNotes();
                await this.openEditDialog(noteResult.uuid);
            }
        } catch (error) {
            console.error('Failed to create note:', error);
            alert('Failed to create note');
        }
    }

    async addNoteFromCurrentNode() {
        // Check if a node is selected
        if (!this.selectedNodeType) {
            alert('Please select a node first');
            return;
        }

        // Load folders first if not already loaded
        await this.loadFolders();

        // Show dialog to configure trigger and note details
        const result = await this.showAddNoteFromCurrentNodeDialog();
        if (!result) return;

        try {
            // Create the note
            const response = await api.fetchApi('/autonotes/notes', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    name: result.name,
                    folder_uuid: result.folder_uuid
                }),
            });

            const noteResult = await response.json();
            if (noteResult.uuid) {
                // Update the note with the trigger condition
                await api.fetchApi(`/autonotes/notes/${noteResult.uuid}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        trigger_conditions: [result.triggerCondition]
                    }),
                });

                // Just refresh notes - don't open the edit dialog
                await this.refreshNotes();
            }
        } catch (error) {
            console.error('Failed to create note:', error);
            alert('Failed to create note');
        }
    }

    async showAddNoteDialog() {
        return new Promise((resolve) => {
            // Create overlay
            const overlay = document.createElement('div');
            overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.7);
                z-index: 3000;
                display: flex;
                justify-content: center;
                align-items: center;
            `;

            // Create dialog
            const dialog = document.createElement('div');
            dialog.style.cssText = `
                background: #2a2a2a;
                border: 1px solid #555;
                border-radius: 8px;
                padding: 20px;
                width: 400px;
                color: #fff;
                font-family: Arial, sans-serif;
            `;

            // Title
            const title = document.createElement('h2');
            title.textContent = 'Create New Note';
            title.style.cssText = `
                margin: 0 0 20px 0;
                font-size: 1.3em;
            `;

            // Name input
            const nameLabel = document.createElement('label');
            nameLabel.textContent = 'Note Name:';
            nameLabel.style.cssText = `
                display: block;
                margin-bottom: 5px;
            `;

            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.placeholder = 'Enter note name...';
            nameInput.style.cssText = `
                width: 100%;
                padding: 8px;
                background: #1a1a1a;
                color: #fff;
                border: 1px solid #555;
                border-radius: 4px;
                box-sizing: border-box;
                margin-bottom: 20px;
                font-size: 14px;
            `;

            // Folder selection
            const folderLabel = document.createElement('label');
            folderLabel.textContent = 'Folder:';
            folderLabel.style.cssText = `
                display: block;
                margin-bottom: 5px;
            `;

            const folderTreeContainer = document.createElement('div');
            folderTreeContainer.style.cssText = `
                width: 100%;
                max-height: 200px;
                overflow-y: auto;
                background: #1a1a1a;
                border: 1px solid #555;
                border-radius: 4px;
                margin-bottom: 20px;
                padding: 8px;
            `;

            let selectedFolderUuid = null;

            // Root option
            const rootItem = document.createElement('div');
            rootItem.style.cssText = `
                padding: 5px 8px;
                cursor: pointer;
                border-radius: 3px;
                background: #007acc;
                margin-bottom: 5px;
            `;
            rootItem.textContent = '📁 [Root]';
            rootItem.dataset.folderUuid = '';

            rootItem.addEventListener('click', () => {
                // Remove selection from all items
                folderTreeContainer.querySelectorAll('div[data-folder-uuid]').forEach(item => {
                    item.style.background = '';
                });
                rootItem.style.background = '#007acc';
                selectedFolderUuid = null;
            });

            folderTreeContainer.appendChild(rootItem);

            // Build folder tree recursively
            // level 0 = [Root]
            // level 1 = folders with parent_uuid = null (direct children of root)
            // level 2+ = nested folders
            const buildFolderTree = (parentUuid, level = 1) => {
                // Filter folders by parent - handle both null and undefined
                const childFolders = this.folders.filter(f => {
                    const folderParent = f.parent_uuid || null;
                    const searchParent = parentUuid || null;
                    return folderParent === searchParent;
                });

                for (const folder of childFolders) {
                    const folderItem = document.createElement('div');
                    const indent = 8 + (level * 20);
                    folderItem.style.cssText = `
                        padding: 5px 8px;
                        padding-left: ${indent}px;
                        cursor: pointer;
                        border-radius: 3px;
                        margin-bottom: 2px;
                    `;
                    folderItem.textContent = `${'  '.repeat(level)}📁 ${folder.name}`;
                    folderItem.dataset.folderUuid = folder.uuid;

                    folderItem.addEventListener('click', () => {
                        // Remove selection from all items
                        folderTreeContainer.querySelectorAll('div[data-folder-uuid]').forEach(item => {
                            item.style.background = '';
                        });
                        folderItem.style.background = '#007acc';
                        selectedFolderUuid = folder.uuid;
                    });

                    folderTreeContainer.appendChild(folderItem);

                    // Recursively build child folders
                    buildFolderTree(folder.uuid, level + 1);
                }
            };

            // Start building from root (null parent) at level 1
            // Level 0 is [Root] itself, so children start at level 1
            buildFolderTree(null, 1);

            // Buttons
            const buttonContainer = document.createElement('div');
            buttonContainer.style.cssText = `
                display: flex;
                justify-content: flex-end;
                gap: 10px;
            `;

            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = 'Cancel';
            cancelBtn.style.cssText = `
                background: #666;
                color: white;
                border: none;
                padding: 8px 20px;
                cursor: pointer;
                border-radius: 4px;
            `;

            const createBtn = document.createElement('button');
            createBtn.textContent = 'Create';
            createBtn.style.cssText = `
                background: #007acc;
                color: white;
                border: none;
                padding: 8px 20px;
                cursor: pointer;
                border-radius: 4px;
            `;

            // Event handlers
            const closeDialog = (result) => {
                overlay.remove();
                resolve(result);
            };

            cancelBtn.addEventListener('click', () => closeDialog(null));

            createBtn.addEventListener('click', () => {
                const name = nameInput.value.trim();
                if (!name) {
                    alert('Please enter a note name');
                    return;
                }

                closeDialog({
                    name: name,
                    folder_uuid: selectedFolderUuid
                });
            });

            // Allow Enter key to create
            nameInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    createBtn.click();
                }
            });

            // Focus name input
            setTimeout(() => nameInput.focus(), 0);

            // Assemble dialog
            buttonContainer.appendChild(cancelBtn);
            buttonContainer.appendChild(createBtn);

            dialog.appendChild(title);
            dialog.appendChild(nameLabel);
            dialog.appendChild(nameInput);
            dialog.appendChild(folderLabel);
            dialog.appendChild(folderTreeContainer);
            dialog.appendChild(buttonContainer);

            overlay.appendChild(dialog);
            document.body.appendChild(overlay);

            // Close on overlay click
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    closeDialog(null);
                }
            });
        });
    }

    async openEditDialog(noteUuid = null) {
        if (this.editDialog) {
            this.editDialog.remove();
        }

        await this.loadFolders();
        // Load all notes for the edit dialog, regardless of display mode
        await this.loadAllNotes();
        this.createEditDialog(noteUuid);
    }

    async loadAllNotes() {
        try {
            const response = await api.fetchApi('/autonotes/notes?mode=all');
            this.notes = await response.json();
        } catch (error) {
            console.error('Failed to load all notes:', error);
        }
    }

    async showAddNoteFromCurrentNodeDialog() {
        return new Promise((resolve) => {
            // Create overlay
            const overlay = document.createElement('div');
            overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.7);
                z-index: 3000;
                display: flex;
                justify-content: center;
                align-items: center;
            `;

            // Create dialog
            const dialog = document.createElement('div');
            dialog.style.cssText = `
                background: #2a2a2a;
                border: 1px solid #555;
                border-radius: 8px;
                padding: 20px;
                width: 500px;
                max-height: 80vh;
                overflow-y: auto;
                color: #fff;
                font-family: Arial, sans-serif;
            `;

            // Title
            const title = document.createElement('h2');
            title.textContent = 'Create Note from Current Node';
            title.style.cssText = `
                margin: 0 0 20px 0;
                font-size: 1.3em;
            `;

            // Current node info
            const nodeInfo = document.createElement('div');
            nodeInfo.style.cssText = `
                background: #1a1a1a;
                padding: 10px;
                border-radius: 4px;
                margin-bottom: 20px;
                border: 1px solid #555;
            `;
            const nodeInfoText = document.createElement('div');
            nodeInfoText.textContent = `Selected Node: ${this.nodeTypes[this.selectedNodeType]?.display_name || this.selectedNodeType}`;
            nodeInfoText.style.fontWeight = 'bold';
            nodeInfo.appendChild(nodeInfoText);

            // Name input
            const nameLabel = document.createElement('label');
            nameLabel.textContent = 'Note Name:';
            nameLabel.style.cssText = `
                display: block;
                margin-bottom: 5px;
            `;

            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.value = `Note for ${this.nodeTypes[this.selectedNodeType]?.display_name || this.selectedNodeType}`;
            nameInput.style.cssText = `
                width: 100%;
                padding: 8px;
                background: #1a1a1a;
                color: #fff;
                border: 1px solid #555;
                border-radius: 4px;
                box-sizing: border-box;
                margin-bottom: 20px;
                font-size: 14px;
            `;

            // Trigger type selector
            const triggerTypeLabel = document.createElement('label');
            triggerTypeLabel.textContent = 'Trigger Type:';
            triggerTypeLabel.style.cssText = `
                display: block;
                margin-bottom: 5px;
            `;

            const triggerTypeSelect = document.createElement('select');
            triggerTypeSelect.style.cssText = `
                width: 100%;
                padding: 8px;
                background: #1a1a1a;
                color: #fff;
                border: 1px solid #555;
                border-radius: 4px;
                box-sizing: border-box;
                margin-bottom: 20px;
                font-size: 14px;
            `;
            triggerTypeSelect.innerHTML = `
                <option value="node_selected">Node Selected - Shows when this node type is selected</option>
                <option value="node_attribute">Node Attribute - Shows when this node has specific attribute value</option>
                <option value="node_in_workflow">Node in Workflow - Shows when this node exists in workflow</option>
                <option value="attribute_in_workflow">Attribute in Workflow - Shows when this node has an attribute in workflow</option>
            `;

            // Dynamic fields container
            const dynamicFieldsContainer = document.createElement('div');
            dynamicFieldsContainer.style.marginBottom = '20px';

            // Trigger condition object
            const triggerCondition = {
                type: 'node_selected',
                node_types: [this.selectedNodeType],
                node_type: this.selectedNodeType,
                attribute_name: null,
                attribute_values: [],
                workflow_names: []
            };

            // Function to update dynamic fields based on trigger type
            const updateDynamicFields = () => {
                dynamicFieldsContainer.innerHTML = '';
                triggerCondition.type = triggerTypeSelect.value;

                if (triggerCondition.type === 'node_selected') {
                    // Already set with current node type
                    triggerCondition.node_types = [this.selectedNodeType];
                    const info = document.createElement('div');
                    info.style.cssText = `
                        background: #1a1a1a;
                        padding: 10px;
                        border-radius: 4px;
                        border: 1px solid #555;
                        color: #aaa;
                    `;
                    info.textContent = `This note will appear when "${this.nodeTypes[this.selectedNodeType]?.display_name || this.selectedNodeType}" is selected.`;
                    dynamicFieldsContainer.appendChild(info);

                } else if (triggerCondition.type === 'node_attribute') {
                    // Attribute selector
                    const attrLabel = document.createElement('label');
                    attrLabel.textContent = 'Attribute:';
                    attrLabel.style.cssText = `
                        display: block;
                        margin-bottom: 5px;
                    `;

                    const attrSelect = document.createElement('select');
                    attrSelect.style.cssText = `
                        width: 100%;
                        padding: 8px;
                        background: #1a1a1a;
                        color: #fff;
                        border: 1px solid #555;
                        border-radius: 4px;
                        margin-bottom: 10px;
                        font-size: 14px;
                    `;

                    // Populate with node attributes
                    const emptyOption = document.createElement('option');
                    emptyOption.value = '';
                    emptyOption.textContent = '-- Select Attribute --';
                    attrSelect.appendChild(emptyOption);

                    if (this.nodeTypes[this.selectedNodeType]) {
                        const nodeInfo = this.nodeTypes[this.selectedNodeType];
                        const inputs = nodeInfo.input?.required || {};
                        const optionalInputs = nodeInfo.input?.optional || {};
                        const allInputs = { ...inputs, ...optionalInputs };

                        Object.keys(allInputs).forEach(attrName => {
                            const option = document.createElement('option');
                            option.value = attrName;
                            option.textContent = attrName;
                            attrSelect.appendChild(option);
                        });
                    }

                    // Value input
                    const valueLabel = document.createElement('label');
                    valueLabel.textContent = 'Attribute Value (to match):';
                    valueLabel.style.cssText = `
                        display: block;
                        margin-bottom: 5px;
                    `;

                    const valueInput = document.createElement('input');
                    valueInput.type = 'text';
                    valueInput.placeholder = 'Enter value...';
                    valueInput.style.cssText = `
                        width: 100%;
                        padding: 8px;
                        background: #1a1a1a;
                        color: #fff;
                        border: 1px solid #555;
                        border-radius: 4px;
                        font-size: 14px;
                    `;

                    // Update value input when attribute changes
                    attrSelect.addEventListener('change', () => {
                        triggerCondition.attribute_name = attrSelect.value;
                        // Pre-fill with current value if available
                        if (this.selectedNodeAttributes[attrSelect.value] !== undefined) {
                            valueInput.value = String(this.selectedNodeAttributes[attrSelect.value]);
                            triggerCondition.attribute_values = [valueInput.value];
                        } else {
                            valueInput.value = '';
                            triggerCondition.attribute_values = [];
                        }
                    });

                    valueInput.addEventListener('input', () => {
                        triggerCondition.attribute_values = valueInput.value ? [valueInput.value] : [];
                    });

                    dynamicFieldsContainer.appendChild(attrLabel);
                    dynamicFieldsContainer.appendChild(attrSelect);
                    dynamicFieldsContainer.appendChild(valueLabel);
                    dynamicFieldsContainer.appendChild(valueInput);

                } else if (triggerCondition.type === 'node_in_workflow') {
                    // Already set with current node type
                    triggerCondition.node_types = [this.selectedNodeType];
                    const info = document.createElement('div');
                    info.style.cssText = `
                        background: #1a1a1a;
                        padding: 10px;
                        border-radius: 4px;
                        border: 1px solid #555;
                        color: #aaa;
                    `;
                    info.textContent = `This note will appear when "${this.nodeTypes[this.selectedNodeType]?.display_name || this.selectedNodeType}" exists anywhere in the workflow.`;
                    dynamicFieldsContainer.appendChild(info);

                } else if (triggerCondition.type === 'attribute_in_workflow') {
                    // Attribute selector
                    const attrLabel = document.createElement('label');
                    attrLabel.textContent = 'Attribute:';
                    attrLabel.style.cssText = `
                        display: block;
                        margin-bottom: 5px;
                    `;

                    const attrSelect = document.createElement('select');
                    attrSelect.style.cssText = `
                        width: 100%;
                        padding: 8px;
                        background: #1a1a1a;
                        color: #fff;
                        border: 1px solid #555;
                        border-radius: 4px;
                        margin-bottom: 10px;
                        font-size: 14px;
                    `;

                    // Populate with node attributes
                    const emptyOption = document.createElement('option');
                    emptyOption.value = '';
                    emptyOption.textContent = '-- Select Attribute --';
                    attrSelect.appendChild(emptyOption);

                    if (this.nodeTypes[this.selectedNodeType]) {
                        const nodeInfo = this.nodeTypes[this.selectedNodeType];
                        const inputs = nodeInfo.input?.required || {};
                        const optionalInputs = nodeInfo.input?.optional || {};
                        const allInputs = { ...inputs, ...optionalInputs };

                        Object.keys(allInputs).forEach(attrName => {
                            const option = document.createElement('option');
                            option.value = attrName;
                            option.textContent = attrName;
                            attrSelect.appendChild(option);
                        });
                    }

                    // Value input (optional)
                    const valueLabel = document.createElement('label');
                    valueLabel.textContent = 'Attribute Value (optional, leave blank for any):';
                    valueLabel.style.cssText = `
                        display: block;
                        margin-bottom: 5px;
                    `;

                    const valueInput = document.createElement('input');
                    valueInput.type = 'text';
                    valueInput.placeholder = 'Enter value or leave blank...';
                    valueInput.style.cssText = `
                        width: 100%;
                        padding: 8px;
                        background: #1a1a1a;
                        color: #fff;
                        border: 1px solid #555;
                        border-radius: 4px;
                        font-size: 14px;
                    `;

                    // Update value input when attribute changes
                    attrSelect.addEventListener('change', () => {
                        triggerCondition.attribute_name = attrSelect.value;
                        // Pre-fill with current value if available
                        if (this.selectedNodeAttributes[attrSelect.value] !== undefined) {
                            valueInput.value = String(this.selectedNodeAttributes[attrSelect.value]);
                            triggerCondition.attribute_values = [valueInput.value];
                        } else {
                            valueInput.value = '';
                            triggerCondition.attribute_values = [];
                        }
                    });

                    valueInput.addEventListener('input', () => {
                        triggerCondition.attribute_values = valueInput.value ? [valueInput.value] : [];
                    });

                    dynamicFieldsContainer.appendChild(attrLabel);
                    dynamicFieldsContainer.appendChild(attrSelect);
                    dynamicFieldsContainer.appendChild(valueLabel);
                    dynamicFieldsContainer.appendChild(valueInput);
                }
            };

            triggerTypeSelect.addEventListener('change', updateDynamicFields);
            updateDynamicFields();

            // Folder selection
            const folderLabel = document.createElement('label');
            folderLabel.textContent = 'Folder:';
            folderLabel.style.cssText = `
                display: block;
                margin-bottom: 5px;
            `;

            const folderTreeContainer = document.createElement('div');
            folderTreeContainer.style.cssText = `
                max-height: 150px;
                overflow-y: auto;
                background: #1a1a1a;
                border: 1px solid #555;
                border-radius: 4px;
                padding: 10px;
                margin-bottom: 20px;
            `;

            let selectedFolderUuid = null;

            // Build folder tree
            const buildFolderTree = (parentUuid, level) => {
                const children = this.folders.filter(f => f.parent_uuid === parentUuid);
                children.forEach(folder => {
                    const folderOption = document.createElement('div');
                    folderOption.style.cssText = `
                        padding: 5px;
                        padding-left: ${level * 15}px;
                        cursor: pointer;
                        border-radius: 3px;
                    `;
                    folderOption.textContent = `📁 ${folder.name}`;

                    folderOption.addEventListener('mouseenter', () => {
                        folderOption.style.background = '#007acc';
                    });
                    folderOption.addEventListener('mouseleave', () => {
                        if (selectedFolderUuid !== folder.uuid) {
                            folderOption.style.background = '';
                        }
                    });
                    folderOption.addEventListener('click', () => {
                        // Deselect previous
                        folderTreeContainer.querySelectorAll('div').forEach(el => {
                            el.style.background = '';
                        });
                        selectedFolderUuid = folder.uuid;
                        folderOption.style.background = '#007acc';
                    });

                    folderTreeContainer.appendChild(folderOption);
                    buildFolderTree(folder.uuid, level + 1);
                });
            };

            // Add root option
            const rootOption = document.createElement('div');
            rootOption.style.cssText = `
                padding: 5px;
                cursor: pointer;
                border-radius: 3px;
                background: #007acc;
            `;
            rootOption.textContent = '[Root]';
            rootOption.addEventListener('mouseenter', () => {
                rootOption.style.background = '#007acc';
            });
            rootOption.addEventListener('mouseleave', () => {
                if (selectedFolderUuid !== null) {
                    rootOption.style.background = '';
                }
            });
            rootOption.addEventListener('click', () => {
                folderTreeContainer.querySelectorAll('div').forEach(el => {
                    el.style.background = '';
                });
                selectedFolderUuid = null;
                rootOption.style.background = '#007acc';
            });
            folderTreeContainer.appendChild(rootOption);
            buildFolderTree(null, 1);

            // Buttons
            const buttonContainer = document.createElement('div');
            buttonContainer.style.cssText = `
                display: flex;
                justify-content: flex-end;
                gap: 10px;
            `;

            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = 'Cancel';
            cancelBtn.style.cssText = `
                background: #666;
                color: white;
                border: none;
                padding: 8px 16px;
                cursor: pointer;
                border-radius: 4px;
            `;
            cancelBtn.addEventListener('click', () => {
                document.body.removeChild(overlay);
                resolve(null);
            });

            const createBtn = document.createElement('button');
            createBtn.textContent = 'Create';
            createBtn.style.cssText = `
                background: #007acc;
                color: white;
                border: none;
                padding: 8px 16px;
                cursor: pointer;
                border-radius: 4px;
            `;
            createBtn.addEventListener('click', () => {
                const name = nameInput.value.trim();
                if (!name) {
                    alert('Please enter a note name');
                    return;
                }

                // Validate trigger condition
                if (triggerCondition.type === 'node_attribute' || triggerCondition.type === 'attribute_in_workflow') {
                    if (!triggerCondition.attribute_name) {
                        alert('Please select an attribute');
                        return;
                    }
                }

                document.body.removeChild(overlay);
                resolve({
                    name,
                    folder_uuid: selectedFolderUuid,
                    triggerCondition
                });
            });

            // Handle Enter key
            nameInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    createBtn.click();
                }
            });

            // Focus name input
            setTimeout(() => nameInput.focus(), 0);

            // Assemble dialog
            buttonContainer.appendChild(cancelBtn);
            buttonContainer.appendChild(createBtn);

            dialog.appendChild(title);
            dialog.appendChild(nodeInfo);
            dialog.appendChild(nameLabel);
            dialog.appendChild(nameInput);
            dialog.appendChild(triggerTypeLabel);
            dialog.appendChild(triggerTypeSelect);
            dialog.appendChild(dynamicFieldsContainer);
            dialog.appendChild(folderLabel);
            dialog.appendChild(folderTreeContainer);
            dialog.appendChild(buttonContainer);

            overlay.appendChild(dialog);
            document.body.appendChild(overlay);

            // Close on overlay click
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    document.body.removeChild(overlay);
                    resolve(null);
                }
            });
        });
    }

    async loadFolders() {
        try {
            const response = await api.fetchApi('/autonotes/folders');
            this.folders = await response.json();
        } catch (error) {
            console.error('Failed to load folders:', error);
            this.folders = [];
        }
    }

    createEditDialog(selectedNoteUuid = null) {
        // Create modal overlay
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.7);
            z-index: 2000;
            display: flex;
            justify-content: center;
            align-items: center;
        `;

        // Load saved dialog size
        const savedWidth = localStorage.getItem('autonotes_editDialogWidth') || '800px';
        const savedHeight = localStorage.getItem('autonotes_editDialogHeight') || '600px';

        // Create dialog
        this.editDialog = document.createElement('div');
        this.editDialog.style.cssText = `
            background: #2a2a2a;
            border: 1px solid #555;
            border-radius: 8px;
            width: ${savedWidth};
            height: ${savedHeight};
            display: flex;
            color: #fff;
            font-family: Arial, sans-serif;
            position: relative;
        `;

        // Track if we're currently resizing to prevent closing on overlay click
        this.isResizingDialog = false;

        // Create resize handles
        const createResizeHandle = (position, cursor) => {
            const handle = document.createElement('div');
            handle.style.cssText = `
                position: absolute;
                background: transparent;
                z-index: 10;
            `;

            if (position === 'right') {
                handle.style.cssText += `
                    right: 0;
                    top: 0;
                    width: 5px;
                    height: 100%;
                    cursor: ${cursor};
                `;
            } else if (position === 'bottom') {
                handle.style.cssText += `
                    bottom: 0;
                    left: 0;
                    width: 100%;
                    height: 5px;
                    cursor: ${cursor};
                `;
            } else if (position === 'corner') {
                handle.style.cssText += `
                    right: 0;
                    bottom: 0;
                    width: 15px;
                    height: 15px;
                    cursor: ${cursor};
                `;
            }

            let isResizing = false;
            let startX, startY, startWidth, startHeight;

            handle.addEventListener('mousedown', (e) => {
                isResizing = true;
                this.isResizingDialog = true;
                startX = e.clientX;
                startY = e.clientY;
                startWidth = this.editDialog.offsetWidth;
                startHeight = this.editDialog.offsetHeight;
                document.body.style.userSelect = 'none';
                e.preventDefault();
                e.stopPropagation();
            });

            document.addEventListener('mousemove', (e) => {
                if (!isResizing) return;

                if (position === 'right' || position === 'corner') {
                    const newWidth = startWidth + (e.clientX - startX);
                    this.editDialog.style.width = Math.max(400, Math.min(window.innerWidth - 40, newWidth)) + 'px';
                }

                if (position === 'bottom' || position === 'corner') {
                    const newHeight = startHeight + (e.clientY - startY);
                    this.editDialog.style.height = Math.max(300, Math.min(window.innerHeight - 40, newHeight)) + 'px';
                }
            });

            document.addEventListener('mouseup', () => {
                if (isResizing) {
                    isResizing = false;
                    document.body.style.userSelect = '';

                    // Save size to localStorage
                    localStorage.setItem('autonotes_editDialogWidth', this.editDialog.style.width);
                    localStorage.setItem('autonotes_editDialogHeight', this.editDialog.style.height);

                    // Delay clearing the flag to prevent overlay click from closing
                    setTimeout(() => {
                        this.isResizingDialog = false;
                    }, 100);
                }
            });

            return handle;
        };

        this.editDialog.appendChild(createResizeHandle('right', 'ew-resize'));
        this.editDialog.appendChild(createResizeHandle('bottom', 'ns-resize'));
        this.editDialog.appendChild(createResizeHandle('corner', 'nwse-resize'));

        // Tree view (left side)
        const treeContainer = document.createElement('div');
        treeContainer.style.cssText = `
            width: 250px;
            border-right: 1px solid #555;
            padding: 10px;
            overflow-y: auto;
        `;

        const treeHeader = document.createElement('div');
        treeHeader.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        `;

        const treeTitle = document.createElement('h3');
        treeTitle.textContent = 'Notes';
        treeTitle.style.margin = '0';

        const folderButtons = document.createElement('div');
        folderButtons.style.display = 'flex';
        folderButtons.style.gap = '5px';

        const addFolderButton = document.createElement('button');
        addFolderButton.textContent = '+';
        addFolderButton.title = 'Add Folder';
        addFolderButton.style.cssText = `
            background: #007acc;
            color: white;
            border: none;
            padding: 2px 8px;
            cursor: pointer;
            border-radius: 3px;
            font-size: 16px;
        `;
        addFolderButton.addEventListener('click', () => this.addFolder(treeContainer, selectedNoteUuid));

        folderButtons.appendChild(addFolderButton);

        treeHeader.appendChild(treeTitle);
        treeHeader.appendChild(folderButtons);
        treeContainer.appendChild(treeHeader);

        this.renderNoteTree(treeContainer, selectedNoteUuid);

        // Make tree container a drop target for root
        treeContainer.addEventListener('dragover', (e) => {
            // Check if we're over empty space (not over a folder or note)
            const target = e.target;
            if (target === treeContainer || target === treeHeader || target === treeTitle) {
                e.preventDefault();
                treeContainer.style.background = 'rgba(0, 122, 204, 0.1)';
            }
        });

        treeContainer.addEventListener('dragleave', (e) => {
            if (e.target === treeContainer) {
                treeContainer.style.background = '';
            }
        });

        treeContainer.addEventListener('drop', async (e) => {
            // Only handle if dropped on empty space
            const target = e.target;
            if (target === treeContainer || target === treeHeader || target === treeTitle) {
                e.preventDefault();
                treeContainer.style.background = '';

                const noteUuid = e.dataTransfer.getData('application/x-note-uuid');
                const folderUuid = e.dataTransfer.getData('application/x-folder-uuid');

                if (noteUuid) {
                    await this.moveNoteToFolder(noteUuid, null, treeContainer, selectedNoteUuid);
                } else if (folderUuid) {
                    await this.moveFolderToFolder(folderUuid, null, treeContainer, selectedNoteUuid);
                }
            }
        });

        // Edit panel (right side)
        const editPanel = document.createElement('div');
        editPanel.style.cssText = `
            flex: 1;
            padding: 10px;
            display: flex;
            flex-direction: column;
        `;

        this.createEditPanel(editPanel, selectedNoteUuid);

        this.editDialog.appendChild(treeContainer);
        this.editDialog.appendChild(editPanel);

        // Auto-save when clicking anywhere in the dialog (except textarea)
        this.editDialog.addEventListener('click', async (e) => {
            if (e.target !== this.contentTextarea && this.currentEditingNote && this.textareaChanged) {
                await this.saveCurrentNote();
                this.textareaChanged = false;
            }
        });

        // Auto-save when clicking on the overlay (outside dialog)
        overlay.addEventListener('click', async (e) => {
            if (e.target === overlay && this.currentEditingNote && this.textareaChanged) {
                await this.saveCurrentNote();
                this.textareaChanged = false;
            }
        });

        // Global document-level click handler for auto-save (catches clicks outside dialog)
        this.globalAutoSaveHandler = async (e) => {
            // Only auto-save if dialog is open and there are changes
            if (this.editDialog && this.currentEditingNote && this.textareaChanged) {
                // Check if click is outside the dialog and not on the textarea
                if (!this.editDialog.contains(e.target) && e.target !== this.contentTextarea) {
                    await this.saveCurrentNote();
                    this.textareaChanged = false;
                }
            }
        };

        // Add the handler with a slight delay to avoid immediate triggering
        setTimeout(() => {
            document.addEventListener('click', this.globalAutoSaveHandler, true);
        }, 100);

        overlay.appendChild(this.editDialog);
        document.body.appendChild(overlay);
    }

    renderNoteTree(container, selectedNoteUuid) {
        // Clear existing tree items (but not the header)
        const existingItems = container.querySelectorAll('.tree-item, .folder-item');
        existingItems.forEach(item => item.remove());

        // Render only root-level folders (parent_uuid === null)
        const rootFolders = this.folders.filter(f => !f.parent_uuid);
        for (const folder of rootFolders) {
            const folderItem = this.createFolderItem(folder, container, selectedNoteUuid);
            container.appendChild(folderItem);
        }

        // Render notes (only top-level notes without folders)
        for (const note of this.notes) {
            if (!note.folder_uuid) {
                const noteItem = this.createNoteItem(note, selectedNoteUuid, container);
                container.appendChild(noteItem);
            }
        }
    }

    createFolderItem(folder, treeContainer, selectedNoteUuid) {
        const folderItem = document.createElement('div');
        folderItem.className = 'folder-item';
        folderItem.style.cssText = `
            margin-bottom: 5px;
        `;

        const folderHeader = document.createElement('div');
        folderHeader.draggable = true;
        folderHeader.style.cssText = `
            display: flex;
            align-items: center;
            gap: 5px;
            padding: 5px;
            border-radius: 3px;
            background: #333;
            cursor: pointer;
        `;

        // Collapse/expand icon
        const expandIcon = document.createElement('span');
        expandIcon.textContent = '▶';
        expandIcon.style.cssText = `
            transition: transform 0.2s;
            font-size: 10px;
        `;

        // Make folder draggable
        folderHeader.addEventListener('dragstart', (e) => {
            e.stopPropagation();
            e.dataTransfer.setData('application/x-folder-uuid', folder.uuid);
            e.dataTransfer.effectAllowed = 'move';
            folderHeader.style.opacity = '0.5';
        });

        folderHeader.addEventListener('dragend', (e) => {
            folderHeader.style.opacity = '1';
        });

        // Make folder a drop target
        folderHeader.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            folderHeader.style.background = '#007acc';
        });

        folderHeader.addEventListener('dragleave', (e) => {
            e.stopPropagation();
            folderHeader.style.background = '#333';
        });

        folderHeader.addEventListener('drop', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            folderHeader.style.background = '#333';

            // Check if it's a note or folder being dropped
            const noteUuid = e.dataTransfer.getData('application/x-note-uuid');
            const folderUuid = e.dataTransfer.getData('application/x-folder-uuid');

            if (noteUuid) {
                await this.moveNoteToFolder(noteUuid, folder.uuid, treeContainer, selectedNoteUuid);
            } else if (folderUuid && folderUuid !== folder.uuid) {
                // Prevent dropping a folder into itself
                await this.moveFolderToFolder(folderUuid, folder.uuid, treeContainer, selectedNoteUuid);
            }
        });

        // Right-click context menu
        folderHeader.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showFolderContextMenu(e, folder, treeContainer, selectedNoteUuid);
        });

        const folderName = document.createElement('span');
        folderName.textContent = `📁 ${folder.name}`;
        folderName.style.flex = '1';

        const renameBtn = document.createElement('button');
        renameBtn.textContent = '✏️';
        renameBtn.title = 'Rename Folder';
        renameBtn.style.cssText = `
            background: transparent;
            border: none;
            color: #fff;
            cursor: pointer;
            padding: 2px;
            font-size: 12px;
        `;
        renameBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.renameFolder(folder, treeContainer, selectedNoteUuid);
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = '🗑️';
        deleteBtn.title = 'Delete Folder';
        deleteBtn.style.cssText = `
            background: transparent;
            border: none;
            color: #fff;
            cursor: pointer;
            padding: 2px;
            font-size: 12px;
        `;
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.deleteFolder(folder, treeContainer, selectedNoteUuid);
        });

        folderHeader.appendChild(expandIcon);
        folderHeader.appendChild(folderName);
        folderHeader.appendChild(renameBtn);
        folderHeader.appendChild(deleteBtn);

        // Children container (child folders and notes)
        const childrenContainer = document.createElement('div');
        childrenContainer.style.cssText = `
            padding-left: 20px;
            display: none;
        `;

        // Find child folders
        const childFolders = this.folders.filter(f => f.parent_uuid === folder.uuid);
        for (const childFolder of childFolders) {
            const childFolderItem = this.createFolderItem(childFolder, treeContainer, selectedNoteUuid);
            childrenContainer.appendChild(childFolderItem);
        }

        // Find notes in this folder
        const folderNotes = this.notes.filter(note => note.folder_uuid === folder.uuid);
        for (const note of folderNotes) {
            const noteItem = this.createNoteItem(note, selectedNoteUuid, treeContainer);
            childrenContainer.appendChild(noteItem);
        }

        // Toggle expand/collapse
        const isExpanded = this.expandedFolders.has(folder.uuid);
        childrenContainer.style.display = isExpanded ? 'block' : 'none';
        expandIcon.style.transform = isExpanded ? 'rotate(90deg)' : 'rotate(0deg)';

        folderHeader.addEventListener('click', (e) => {
            // Don't toggle if clicking buttons
            if (e.target === renameBtn || e.target === deleteBtn) {
                return;
            }

            if (this.expandedFolders.has(folder.uuid)) {
                this.expandedFolders.delete(folder.uuid);
                childrenContainer.style.display = 'none';
                expandIcon.style.transform = 'rotate(0deg)';
            } else {
                this.expandedFolders.add(folder.uuid);
                childrenContainer.style.display = 'block';
                expandIcon.style.transform = 'rotate(90deg)';
            }
        });

        folderItem.appendChild(folderHeader);
        folderItem.appendChild(childrenContainer);

        return folderItem;
    }

    createNoteItem(note, selectedNoteUuid, treeContainer) {
        const noteItem = document.createElement('div');
        noteItem.className = 'tree-item';
        noteItem.draggable = true;
        noteItem.style.cssText = `
            padding: 5px;
            cursor: move;
            border-radius: 3px;
            margin-bottom: 2px;
            ${note.uuid === selectedNoteUuid ? 'background: #007acc;' : ''}
        `;
        noteItem.textContent = note.name || 'Untitled';

        // Drag start
        noteItem.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('application/x-note-uuid', note.uuid);
            e.dataTransfer.effectAllowed = 'move';
            noteItem.style.opacity = '0.5';
        });

        // Drag end
        noteItem.addEventListener('dragend', (e) => {
            noteItem.style.opacity = '1';
        });

        // Left click to select
        noteItem.addEventListener('click', async () => {
            // Auto-save current note before switching
            if (this.currentEditingNote && this.textareaChanged) {
                await this.saveCurrentNote();
                this.textareaChanged = false;
            }

            // Remove previous selection
            treeContainer.querySelectorAll('.tree-item').forEach(item => {
                item.style.background = '';
            });
            noteItem.style.background = '#007acc';

            this.loadNoteIntoEditor(note.uuid);
        });

        // Right click for context menu
        noteItem.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.showNoteContextMenu(e, note, treeContainer, selectedNoteUuid);
        });

        return noteItem;
    }

    createEditPanel(panel, selectedNoteUuid) {
        // Content textarea
        const contentContainer = document.createElement('div');
        contentContainer.style.cssText = `
            flex: 1;
            display: flex;
            flex-direction: column;
            margin-bottom: 10px;
        `;

        const contentLabel = document.createElement('label');
        contentLabel.textContent = 'Content: ';
        contentLabel.style.display = 'block';
        contentLabel.style.marginBottom = '5px';

        this.contentTextarea = document.createElement('textarea');
        this.contentTextarea.style.cssText = `
            flex: 1;
            padding: 10px;
            background: #333;
            color: #fff;
            border: 1px solid #555;
            border-radius: 3px;
            resize: none;
            font-family: monospace;
        `;

        // Track if content has changed
        this.textareaChanged = false;

        // Auto-save on input (debounced)
        let saveTimeout;
        this.contentTextarea.addEventListener('input', () => {
            this.textareaChanged = true;
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(async () => {
                if (this.currentEditingNote && this.textareaChanged) {
                    await this.saveCurrentNote();
                    this.textareaChanged = false;
                }
            }, 1000); // Auto-save after 1 second of inactivity
        });

        // Auto-save on blur (when clicking outside the textarea)
        this.contentTextarea.addEventListener('blur', async () => {
            if (this.currentEditingNote && this.textareaChanged) {
                clearTimeout(saveTimeout);
                await this.saveCurrentNote();
                this.textareaChanged = false;
            }
        });

        contentContainer.appendChild(contentLabel);
        contentContainer.appendChild(this.contentTextarea);

        // Format style
        const formatContainer = document.createElement('div');
        formatContainer.style.cssText = `
            display: flex;
            gap: 20px;
            margin-bottom: 10px;
            align-items: center;
        `;

        const formatDiv = document.createElement('div');
        const formatLabel = document.createElement('label');
        formatLabel.textContent = 'Format: ';
        formatLabel.style.marginRight = '10px';

        this.formatSelect = document.createElement('select');
        this.formatSelect.style.cssText = `
            background: #333;
            color: #fff;
            border: 1px solid #555;
            padding: 5px;
        `;
        this.formatSelect.innerHTML = `
            <option value="plaintext">Plain Text</option>
            <option value="markdown">Markdown</option>
        `;

        formatDiv.appendChild(formatLabel);
        formatDiv.appendChild(this.formatSelect);

        // Pinned checkbox
        const pinnedDiv = document.createElement('div');
        this.pinnedCheckbox = document.createElement('input');
        this.pinnedCheckbox.type = 'checkbox';
        this.pinnedCheckbox.id = 'note-pinned';

        const pinnedLabel = document.createElement('label');
        pinnedLabel.htmlFor = 'note-pinned';
        pinnedLabel.textContent = 'Pinned';
        pinnedLabel.style.marginLeft = '5px';

        pinnedDiv.appendChild(this.pinnedCheckbox);
        pinnedDiv.appendChild(pinnedLabel);

        formatContainer.appendChild(formatDiv);
        formatContainer.appendChild(pinnedDiv);

        // Tags section
        const tagsContainer = document.createElement('div');
        tagsContainer.style.cssText = `
            margin-bottom: 10px;
            border: 1px solid #555;
            border-radius: 4px;
            padding: 10px;
        `;

        const tagsHeader = document.createElement('div');
        tagsHeader.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        `;

        const tagsTitle = document.createElement('h4');
        tagsTitle.textContent = 'Tags';
        tagsTitle.style.margin = '0';

        const addTagButton = document.createElement('button');
        addTagButton.textContent = '+ Add Tag';
        addTagButton.style.cssText = `
            background: #007acc;
            color: white;
            border: none;
            padding: 5px 10px;
            cursor: pointer;
            border-radius: 3px;
            font-size: 11px;
        `;

        tagsHeader.appendChild(tagsTitle);
        tagsHeader.appendChild(addTagButton);

        this.tagsListContainer = document.createElement('div');
        this.tagsListContainer.style.cssText = `
            display: flex;
            flex-wrap: wrap;
            gap: 5px;
        `;

        this.currentTags = [];

        addTagButton.addEventListener('click', () => {
            const tag = prompt('Enter tag name:');
            if (tag && tag.trim()) {
                const trimmedTag = tag.trim();
                if (!this.currentTags.includes(trimmedTag)) {
                    this.currentTags.push(trimmedTag);
                    this.renderTags();
                    this.textareaChanged = true; // Mark as changed for auto-save
                }
            }
        });

        tagsContainer.appendChild(tagsHeader);
        tagsContainer.appendChild(this.tagsListContainer);

        // Trigger conditions section
        const triggerContainer = document.createElement('div');
        triggerContainer.style.cssText = `
            margin-bottom: 10px;
            border: 1px solid #555;
            border-radius: 4px;
            padding: 10px;
            max-height: 200px;
            overflow-y: auto;
        `;

        const triggerTitle = document.createElement('h4');
        triggerTitle.textContent = 'Trigger Conditions';
        triggerTitle.style.margin = '0 0 10px 0';

        const addTriggerButton = document.createElement('button');
        addTriggerButton.textContent = 'Add Trigger';
        addTriggerButton.style.cssText = `
            background: #007acc;
            color: white;
            border: none;
            padding: 5px 10px;
            cursor: pointer;
            border-radius: 3px;
            margin-bottom: 10px;
        `;
        addTriggerButton.addEventListener('click', () => this.addTriggerCondition());

        this.triggerList = document.createElement('div');

        triggerContainer.appendChild(triggerTitle);
        triggerContainer.appendChild(addTriggerButton);
        triggerContainer.appendChild(this.triggerList);

        // Buttons
        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = `
            display: flex;
            justify-content: space-between;
            margin-top: 10px;
        `;

        const leftButtons = document.createElement('div');
        leftButtons.style.display = 'flex';
        leftButtons.style.gap = '10px';

        const saveButton = document.createElement('button');
        saveButton.textContent = 'Save';
        saveButton.style.cssText = `
            background: #007acc;
            color: white;
            border: none;
            padding: 8px 16px;
            cursor: pointer;
            border-radius: 4px;
        `;
        saveButton.addEventListener('click', () => this.saveCurrentNote());

        const revertButton = document.createElement('button');
        revertButton.textContent = 'Revert';
        revertButton.style.cssText = `
            background: #666;
            color: white;
            border: none;
            padding: 8px 16px;
            cursor: pointer;
            border-radius: 4px;
        `;

        leftButtons.appendChild(saveButton);
        leftButtons.appendChild(revertButton);

        const rightButtons = document.createElement('div');
        rightButtons.style.display = 'flex';
        rightButtons.style.gap = '10px';

        const okButton = document.createElement('button');
        okButton.textContent = 'OK';
        okButton.style.cssText = `
            background: #007acc;
            color: white;
            border: none;
            padding: 8px 16px;
            cursor: pointer;
            border-radius: 4px;
        `;
        okButton.addEventListener('click', () => this.closeEditDialog(true));

        const cancelButton = document.createElement('button');
        cancelButton.textContent = 'Cancel';
        cancelButton.style.cssText = `
            background: #666;
            color: white;
            border: none;
            padding: 8px 16px;
            cursor: pointer;
            border-radius: 4px;
        `;
        cancelButton.addEventListener('click', () => this.closeEditDialog(false));

        rightButtons.appendChild(okButton);
        rightButtons.appendChild(cancelButton);

        buttonContainer.appendChild(leftButtons);
        buttonContainer.appendChild(rightButtons);

        panel.appendChild(contentContainer);
        panel.appendChild(formatContainer);
        panel.appendChild(tagsContainer);
        panel.appendChild(triggerContainer);
        panel.appendChild(buttonContainer);

        // Load initial note if specified
        if (selectedNoteUuid) {
            this.loadNoteIntoEditor(selectedNoteUuid);
        }
    }

    loadNoteIntoEditor(noteUuid) {
        const note = this.notes.find(n => n.uuid === noteUuid);
        if (!note) return;

        this.currentEditingNote = note;
        this.contentTextarea.value = note.content || '';
        this.formatSelect.value = note.format_style || 'plaintext';
        this.pinnedCheckbox.checked = note.pinned || false;

        // Load tags
        this.currentTags = [...(note.tags || [])];
        this.renderTags();

        // Load trigger conditions
        this.currentTriggerConditions = [...(note.trigger_conditions || [])];
        this.renderTriggerConditions();
    }

    renderTags() {
        this.tagsListContainer.innerHTML = '';

        for (const tag of this.currentTags) {
            const tagElement = document.createElement('div');
            tagElement.style.cssText = `
                background: #007acc;
                color: white;
                padding: 4px 8px;
                border-radius: 3px;
                font-size: 12px;
                display: flex;
                align-items: center;
                gap: 5px;
            `;

            const tagText = document.createElement('span');
            tagText.textContent = tag;

            const removeBtn = document.createElement('button');
            removeBtn.textContent = '×';
            removeBtn.style.cssText = `
                background: transparent;
                border: none;
                color: white;
                cursor: pointer;
                font-size: 16px;
                padding: 0;
                line-height: 1;
            `;
            removeBtn.addEventListener('click', () => {
                this.currentTags = this.currentTags.filter(t => t !== tag);
                this.renderTags();
                this.textareaChanged = true; // Mark as changed for auto-save
            });

            tagElement.appendChild(tagText);
            tagElement.appendChild(removeBtn);
            this.tagsListContainer.appendChild(tagElement);
        }
    }

    addTriggerCondition() {
        const condition = {
            type: 'node_selected',
            node_types: [],
            node_type: null,
            attribute_name: null,
            attribute_values: [],
            workflow_names: []
        };

        this.currentTriggerConditions = this.currentTriggerConditions || [];
        this.currentTriggerConditions.push(condition);
        this.renderTriggerConditions();
    }

    renderTriggerConditions() {
        this.triggerList.innerHTML = '';

        if (!this.currentTriggerConditions) {
            this.currentTriggerConditions = [];
        }

        this.currentTriggerConditions.forEach((condition, index) => {
            const conditionElement = this.createTriggerConditionElement(condition, index);
            this.triggerList.appendChild(conditionElement);
        });
    }

    createTriggerConditionElement(condition, index) {
        const container = document.createElement('div');
        container.style.cssText = `
            border: 1px solid #666;
            border-radius: 3px;
            margin-bottom: 10px;
            background: #333;
        `;

        // Header (collapsible)
        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            align-items: center;
            padding: 10px;
            cursor: pointer;
            background: #3a3a3a;
            border-radius: 3px 3px 0 0;
        `;

        // Collapse icon
        const collapseIcon = document.createElement('span');
        collapseIcon.textContent = '▼';
        collapseIcon.style.cssText = `
            transition: transform 0.2s;
            margin-right: 10px;
            font-size: 10px;
        `;

        // Title showing condition type
        const titleSpan = document.createElement('span');
        titleSpan.style.flex = '1';
        const getConditionTitle = () => {
            if (condition.type === 'node_selected') return 'Node Selected';
            if (condition.type === 'node_attribute') return 'Node Attribute';
            if (condition.type === 'node_in_workflow') return 'Node in Workflow';
            if (condition.type === 'attribute_in_workflow') return 'Attribute in Workflow';
            if (condition.type === 'workflow_name') return 'Workflow Name';
            return 'Trigger Condition';
        };
        titleSpan.textContent = getConditionTitle();

        header.appendChild(collapseIcon);
        header.appendChild(titleSpan);

        // Content container (collapsible)
        const content = document.createElement('div');
        content.style.cssText = `
            padding: 10px;
            display: block;
        `;

        // Type selector
        const typeContainer = document.createElement('div');
        typeContainer.style.cssText = `
            display: flex;
            align-items: center;
            margin-bottom: 10px;
        `;

        const typeLabel = document.createElement('label');
        typeLabel.textContent = 'Type: ';
        typeLabel.style.marginRight = '10px';

        const typeSelect = document.createElement('select');
        typeSelect.style.cssText = `
            background: #2a2a2a;
            color: #fff;
            border: 1px solid #555;
            padding: 5px;
            margin-right: 10px;
        `;
        typeSelect.innerHTML = `
            <option value="node_selected">Node Selected</option>
            <option value="node_attribute">Node Attribute</option>
            <option value="node_in_workflow">Node in Workflow</option>
            <option value="attribute_in_workflow">Attribute in Workflow</option>
            <option value="workflow_name">Workflow Name</option>
        `;
        typeSelect.value = condition.type;

        const removeButton = document.createElement('button');
        removeButton.textContent = 'Remove';
        removeButton.style.cssText = `
            background: #cc0000;
            color: white;
            border: none;
            padding: 5px 10px;
            cursor: pointer;
            border-radius: 3px;
            margin-left: auto;
        `;
        removeButton.addEventListener('click', (e) => {
            e.stopPropagation();
            this.currentTriggerConditions.splice(index, 1);
            this.renderTriggerConditions();
        });

        typeContainer.appendChild(typeLabel);
        typeContainer.appendChild(typeSelect);
        typeContainer.appendChild(removeButton);

        // Fields container for type-specific fields
        const fieldsContainer = document.createElement('div');

        const updateContent = () => {
            condition.type = typeSelect.value;
            titleSpan.textContent = getConditionTitle();
            fieldsContainer.innerHTML = '';

            if (condition.type === 'node_selected') {
                this.createNodeSelectedFields(fieldsContainer, condition);
            } else if (condition.type === 'node_attribute') {
                this.createNodeAttributeFields(fieldsContainer, condition);
            } else if (condition.type === 'node_in_workflow') {
                this.createNodeInWorkflowFields(fieldsContainer, condition);
            } else if (condition.type === 'attribute_in_workflow') {
                this.createAttributeInWorkflowFields(fieldsContainer, condition);
            } else if (condition.type === 'workflow_name') {
                this.createWorkflowNameFields(fieldsContainer, condition);
            }
        };

        typeSelect.addEventListener('change', updateContent);
        updateContent();

        content.appendChild(typeContainer);
        content.appendChild(fieldsContainer);

        // Collapse/expand functionality
        let isCollapsed = false;
        header.addEventListener('click', (e) => {
            // Don't collapse if clicking on buttons/inputs
            if (e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT') {
                return;
            }

            isCollapsed = !isCollapsed;
            content.style.display = isCollapsed ? 'none' : 'block';
            collapseIcon.style.transform = isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
        });

        container.appendChild(header);
        container.appendChild(content);

        return container;
    }

    createNodeSelectedFields(container, condition) {
        const label = document.createElement('label');
        label.textContent = 'Node Types: ';
        label.style.display = 'block';
        label.style.marginBottom = '5px';

        // Multi-select dropdown with searchable autocomplete
        const selectContainer = document.createElement('div');
        selectContainer.style.cssText = `
            position: relative;
            width: 100%;
        `;

        // Create a searchable input
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = 'Search node types...';
        searchInput.style.cssText = `
            width: 100%;
            padding: 5px;
            background: #2a2a2a;
            color: #fff;
            border: 1px solid #555;
            border-radius: 3px;
            margin-bottom: 5px;
        `;

        // Selected items display
        const selectedDisplay = document.createElement('div');
        selectedDisplay.style.cssText = `
            display: flex;
            flex-wrap: wrap;
            gap: 5px;
            margin-bottom: 10px;
            min-height: 30px;
            padding: 5px;
            background: #2a2a2a;
            border: 1px solid #555;
            border-radius: 3px;
        `;

        // Dropdown list
        const dropdownList = document.createElement('div');
        dropdownList.style.cssText = `
            position: absolute;
            width: 100%;
            max-height: 200px;
            overflow-y: auto;
            background: #2a2a2a;
            border: 1px solid #555;
            border-radius: 3px;
            z-index: 1000;
            display: none;
        `;

        // Get node types from workflow
        const workflowNodeTypes = new Set();
        if (app.graph && app.graph._nodes) {
            for (const node of app.graph._nodes) {
                workflowNodeTypes.add(node.type);
            }
        }

        // Populate dropdown with all node types
        const nodeTypesList = Object.keys(this.nodeTypes).sort();

        const updateSelectedDisplay = () => {
            selectedDisplay.innerHTML = '';
            (condition.node_types || []).forEach(nodeType => {
                const tag = document.createElement('span');
                tag.style.cssText = `
                    background: #007acc;
                    color: #fff;
                    padding: 3px 8px;
                    border-radius: 3px;
                    display: inline-flex;
                    align-items: center;
                    gap: 5px;
                `;

                // Add icon if in workflow
                if (workflowNodeTypes.has(nodeType)) {
                    const icon = document.createElement('span');
                    icon.textContent = '✓';
                    icon.style.color = '#0f0';
                    tag.appendChild(icon);
                }

                const nameSpan = document.createElement('span');
                nameSpan.textContent = this.nodeTypes[nodeType]?.display_name || nodeType;
                tag.appendChild(nameSpan);

                const removeBtn = document.createElement('span');
                removeBtn.textContent = '×';
                removeBtn.style.cursor = 'pointer';
                removeBtn.style.fontWeight = 'bold';
                removeBtn.addEventListener('click', () => {
                    condition.node_types = condition.node_types.filter(t => t !== nodeType);
                    updateSelectedDisplay();
                });
                tag.appendChild(removeBtn);

                selectedDisplay.appendChild(tag);
            });
        };

        const filterDropdown = (searchTerm) => {
            dropdownList.innerHTML = '';
            const filtered = nodeTypesList.filter(nodeType => {
                const displayName = this.nodeTypes[nodeType]?.display_name || nodeType;
                return displayName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                       nodeType.toLowerCase().includes(searchTerm.toLowerCase());
            });

            filtered.forEach(nodeType => {
                const option = document.createElement('div');
                option.style.cssText = `
                    padding: 8px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 5px;
                `;

                // Add checkmark if in workflow
                if (workflowNodeTypes.has(nodeType)) {
                    const icon = document.createElement('span');
                    icon.textContent = '✓';
                    icon.style.color = '#0f0';
                    icon.style.fontWeight = 'bold';
                    option.appendChild(icon);
                }

                const nameSpan = document.createElement('span');
                nameSpan.textContent = this.nodeTypes[nodeType]?.display_name || nodeType;
                option.appendChild(nameSpan);

                option.addEventListener('mouseenter', () => {
                    option.style.background = '#007acc';
                });
                option.addEventListener('mouseleave', () => {
                    option.style.background = '';
                });
                option.addEventListener('click', () => {
                    if (!condition.node_types) condition.node_types = [];
                    if (!condition.node_types.includes(nodeType)) {
                        condition.node_types.push(nodeType);
                        updateSelectedDisplay();
                    }
                    searchInput.value = '';
                    dropdownList.style.display = 'none';
                });

                dropdownList.appendChild(option);
            });

            dropdownList.style.display = filtered.length > 0 ? 'block' : 'none';
        };

        searchInput.addEventListener('focus', () => {
            filterDropdown(searchInput.value);
        });

        searchInput.addEventListener('input', () => {
            filterDropdown(searchInput.value);
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!selectContainer.contains(e.target)) {
                dropdownList.style.display = 'none';
            }
        });

        selectContainer.appendChild(searchInput);
        selectContainer.appendChild(dropdownList);

        container.appendChild(label);
        container.appendChild(selectedDisplay);
        container.appendChild(selectContainer);

        // Initialize display
        updateSelectedDisplay();
    }

    createNodeAttributeFields(container, condition) {
        // Node type searchable dropdown
        const nodeTypeContainer = document.createElement('div');
        nodeTypeContainer.style.marginBottom = '10px';

        const nodeTypeLabel = document.createElement('label');
        nodeTypeLabel.textContent = 'Node Type: ';
        nodeTypeLabel.style.display = 'block';
        nodeTypeLabel.style.marginBottom = '5px';

        // Get node types from workflow
        const workflowNodeTypes = new Set();
        if (app.graph && app.graph._nodes) {
            for (const node of app.graph._nodes) {
                workflowNodeTypes.add(node.type);
            }
        }

        const selectContainer = document.createElement('div');
        selectContainer.style.cssText = `
            position: relative;
            width: 100%;
        `;

        // Display selected value
        const selectedDisplay = document.createElement('div');
        selectedDisplay.style.cssText = `
            width: 100%;
            padding: 8px;
            background: #2a2a2a;
            color: #fff;
            border: 1px solid #555;
            border-radius: 3px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 5px;
        `;

        const updateSelectedDisplay = () => {
            selectedDisplay.innerHTML = '';
            if (condition.node_type) {
                if (workflowNodeTypes.has(condition.node_type)) {
                    const icon = document.createElement('span');
                    icon.textContent = '✓';
                    icon.style.color = '#0f0';
                    icon.style.fontWeight = 'bold';
                    selectedDisplay.appendChild(icon);
                }
                const text = document.createElement('span');
                text.textContent = this.nodeTypes[condition.node_type]?.display_name || condition.node_type;
                selectedDisplay.appendChild(text);
            } else {
                const text = document.createElement('span');
                text.textContent = '-- Select Node Type --';
                text.style.color = '#888';
                selectedDisplay.appendChild(text);
            }
        };

        // Search input
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = 'Search node types...';
        searchInput.style.cssText = `
            width: 100%;
            padding: 5px;
            background: #2a2a2a;
            color: #fff;
            border: 1px solid #555;
            border-radius: 3px;
            display: none;
        `;

        // Dropdown list
        const dropdownList = document.createElement('div');
        dropdownList.style.cssText = `
            position: absolute;
            width: 100%;
            max-height: 200px;
            overflow-y: auto;
            background: #2a2a2a;
            border: 1px solid #555;
            border-radius: 3px;
            z-index: 1000;
            display: none;
            margin-top: 2px;
        `;

        const nodeTypesList = Object.keys(this.nodeTypes).sort();

        const filterDropdown = (searchTerm) => {
            dropdownList.innerHTML = '';
            const filtered = nodeTypesList.filter(nodeType => {
                const displayName = this.nodeTypes[nodeType]?.display_name || nodeType;
                return displayName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                       nodeType.toLowerCase().includes(searchTerm.toLowerCase());
            });

            filtered.forEach(nodeType => {
                const option = document.createElement('div');
                option.style.cssText = `
                    padding: 8px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 5px;
                `;

                if (workflowNodeTypes.has(nodeType)) {
                    const icon = document.createElement('span');
                    icon.textContent = '✓';
                    icon.style.color = '#0f0';
                    icon.style.fontWeight = 'bold';
                    option.appendChild(icon);
                }

                const nameSpan = document.createElement('span');
                nameSpan.textContent = this.nodeTypes[nodeType]?.display_name || nodeType;
                option.appendChild(nameSpan);

                option.addEventListener('mouseenter', () => {
                    option.style.background = '#007acc';
                });
                option.addEventListener('mouseleave', () => {
                    option.style.background = '';
                });
                option.addEventListener('click', () => {
                    condition.node_type = nodeType;
                    updateSelectedDisplay();
                    updateAttributeOptions(nodeType);
                    dropdownList.style.display = 'none';
                    searchInput.style.display = 'none';
                    selectedDisplay.style.display = 'flex';
                });

                dropdownList.appendChild(option);
            });

            dropdownList.style.display = filtered.length > 0 ? 'block' : 'none';
        };

        selectedDisplay.addEventListener('click', () => {
            selectedDisplay.style.display = 'none';
            searchInput.style.display = 'block';
            searchInput.focus();
            filterDropdown('');
        });

        searchInput.addEventListener('input', () => {
            filterDropdown(searchInput.value);
        });

        searchInput.addEventListener('blur', () => {
            setTimeout(() => {
                searchInput.style.display = 'none';
                selectedDisplay.style.display = 'flex';
                dropdownList.style.display = 'none';
            }, 200);
        });

        selectContainer.appendChild(selectedDisplay);
        selectContainer.appendChild(searchInput);
        selectContainer.appendChild(dropdownList);

        nodeTypeContainer.appendChild(nodeTypeLabel);
        nodeTypeContainer.appendChild(selectContainer);

        // Attribute name dropdown (populated based on selected node)
        const attrNameContainer = document.createElement('div');
        attrNameContainer.style.marginBottom = '10px';

        const attrNameLabel = document.createElement('label');
        attrNameLabel.textContent = 'Attribute Name: ';
        attrNameLabel.style.display = 'block';
        attrNameLabel.style.marginBottom = '5px';

        const attrNameSelect = document.createElement('select');
        attrNameSelect.style.cssText = `
            width: 100%;
            padding: 5px;
            background: #2a2a2a;
            color: #fff;
            border: 1px solid #555;
            border-radius: 3px;
        `;

        // Function to update attribute dropdown based on selected node type
        const updateAttributeOptions = (nodeType) => {
            attrNameSelect.innerHTML = '';

            // Add empty option
            const emptyOption = document.createElement('option');
            emptyOption.value = '';
            emptyOption.textContent = '-- Select Attribute --';
            attrNameSelect.appendChild(emptyOption);

            if (nodeType && this.nodeTypes[nodeType]) {
                const nodeInfo = this.nodeTypes[nodeType];
                const inputs = nodeInfo.input?.required || {};
                const optionalInputs = nodeInfo.input?.optional || {};

                // Add required inputs
                for (const [inputName, inputDef] of Object.entries(inputs)) {
                    const option = document.createElement('option');
                    option.value = inputName;
                    option.textContent = inputName;
                    if (condition.attribute_name === inputName) {
                        option.selected = true;
                    }
                    attrNameSelect.appendChild(option);
                }

                // Add optional inputs
                for (const [inputName, inputDef] of Object.entries(optionalInputs)) {
                    const option = document.createElement('option');
                    option.value = inputName;
                    option.textContent = `${inputName} (optional)`;
                    if (condition.attribute_name === inputName) {
                        option.selected = true;
                    }
                    attrNameSelect.appendChild(option);
                }
            }
        };

        attrNameSelect.addEventListener('change', () => {
            condition.attribute_name = attrNameSelect.value;
        });

        // Initialize displays
        updateSelectedDisplay();
        updateAttributeOptions(condition.node_type);

        attrNameContainer.appendChild(attrNameLabel);
        attrNameContainer.appendChild(attrNameSelect);

        // Attribute values
        const attrValuesContainer = document.createElement('div');
        attrValuesContainer.style.marginBottom = '10px';

        const attrValuesLabel = document.createElement('label');
        attrValuesLabel.textContent = 'Attribute Values (comma-separated): ';
        attrValuesLabel.style.display = 'block';
        attrValuesLabel.style.marginBottom = '5px';

        const attrValuesInput = document.createElement('input');
        attrValuesInput.type = 'text';
        attrValuesInput.value = (condition.attribute_values || []).join(', ');
        attrValuesInput.placeholder = 'e.g., model1.safetensors, model2.ckpt';
        attrValuesInput.style.cssText = `
            width: 100%;
            padding: 5px;
            background: #2a2a2a;
            color: #fff;
            border: 1px solid #555;
            border-radius: 3px;
        `;

        attrValuesInput.addEventListener('input', () => {
            condition.attribute_values = attrValuesInput.value.split(',').map(s => s.trim()).filter(s => s);
        });

        attrValuesContainer.appendChild(attrValuesLabel);
        attrValuesContainer.appendChild(attrValuesInput);

        container.appendChild(nodeTypeContainer);
        container.appendChild(attrNameContainer);
        container.appendChild(attrValuesContainer);
    }

    createWorkflowNameFields(container, condition) {
        const label = document.createElement('label');
        label.textContent = 'Workflow Names (comma-separated): ';
        label.style.display = 'block';
        label.style.marginBottom = '5px';

        const input = document.createElement('input');
        input.type = 'text';
        input.value = (condition.workflow_names || []).join(', ');
        input.placeholder = 'e.g., portrait, landscape, character';
        input.style.cssText = `
            width: 100%;
            padding: 5px;
            background: #2a2a2a;
            color: #fff;
            border: 1px solid #555;
            border-radius: 3px;
        `;

        input.addEventListener('input', () => {
            condition.workflow_names = input.value.split(',').map(s => s.trim()).filter(s => s);
        });

        container.appendChild(label);
        container.appendChild(input);
    }

    createNodeInWorkflowFields(container, condition) {
        const label = document.createElement('label');
        label.textContent = 'Node Types: ';
        label.style.display = 'block';
        label.style.marginBottom = '5px';

        // Multi-select dropdown with searchable autocomplete
        const selectContainer = document.createElement('div');
        selectContainer.style.cssText = `
            position: relative;
            width: 100%;
        `;

        // Create a searchable input
        const searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = 'Search node types...';
        searchInput.style.cssText = `
            width: 100%;
            padding: 5px;
            background: #2a2a2a;
            color: #fff;
            border: 1px solid #555;
            border-radius: 3px;
            margin-bottom: 5px;
        `;

        // Selected items display
        const selectedDisplay = document.createElement('div');
        selectedDisplay.style.cssText = `
            display: flex;
            flex-wrap: wrap;
            gap: 5px;
            margin-bottom: 10px;
            min-height: 30px;
            padding: 5px;
            background: #2a2a2a;
            border: 1px solid #555;
            border-radius: 3px;
        `;

        // Dropdown list
        const dropdownList = document.createElement('div');
        dropdownList.style.cssText = `
            position: absolute;
            width: 100%;
            max-height: 200px;
            overflow-y: auto;
            background: #2a2a2a;
            border: 1px solid #555;
            border-radius: 3px;
            z-index: 1000;
            display: none;
        `;

        // Get node types from workflow
        const workflowNodeTypes = new Set();
        if (app.graph && app.graph._nodes) {
            for (const node of app.graph._nodes) {
                workflowNodeTypes.add(node.type);
            }
        }

        // Populate dropdown with all node types
        const nodeTypesList = Object.keys(this.nodeTypes).sort();

        const updateSelectedDisplay = () => {
            selectedDisplay.innerHTML = '';
            (condition.node_types || []).forEach(nodeType => {
                const tag = document.createElement('span');
                tag.style.cssText = `
                    background: #007acc;
                    color: #fff;
                    padding: 3px 8px;
                    border-radius: 3px;
                    display: inline-flex;
                    align-items: center;
                    gap: 5px;
                `;

                // Add icon if in workflow
                if (workflowNodeTypes.has(nodeType)) {
                    const icon = document.createElement('span');
                    icon.textContent = '✓';
                    icon.style.color = '#0f0';
                    tag.appendChild(icon);
                }

                const nameSpan = document.createElement('span');
                nameSpan.textContent = this.nodeTypes[nodeType]?.display_name || nodeType;
                tag.appendChild(nameSpan);

                const removeBtn = document.createElement('button');
                removeBtn.textContent = '×';
                removeBtn.style.cssText = `
                    background: transparent;
                    border: none;
                    color: #fff;
                    cursor: pointer;
                    padding: 0 3px;
                    font-size: 16px;
                `;
                removeBtn.addEventListener('click', () => {
                    condition.node_types = condition.node_types.filter(t => t !== nodeType);
                    updateSelectedDisplay();
                });

                tag.appendChild(removeBtn);
                selectedDisplay.appendChild(tag);
            });
        };

        const filterDropdown = (searchTerm) => {
            dropdownList.innerHTML = '';
            const lowerSearch = searchTerm.toLowerCase();

            const filtered = nodeTypesList.filter(nodeType => {
                const displayName = this.nodeTypes[nodeType]?.display_name || nodeType;
                return displayName.toLowerCase().includes(lowerSearch) &&
                       !(condition.node_types || []).includes(nodeType);
            });

            if (filtered.length === 0) {
                dropdownList.style.display = 'none';
                return;
            }

            filtered.forEach(nodeType => {
                const option = document.createElement('div');
                option.style.cssText = `
                    padding: 8px;
                    cursor: pointer;
                    border-bottom: 1px solid #555;
                    display: flex;
                    align-items: center;
                    gap: 5px;
                `;

                // Add icon if in workflow
                if (workflowNodeTypes.has(nodeType)) {
                    const icon = document.createElement('span');
                    icon.textContent = '✓';
                    icon.style.color = '#0f0';
                    option.appendChild(icon);
                }

                const displayName = this.nodeTypes[nodeType]?.display_name || nodeType;
                const textSpan = document.createElement('span');
                textSpan.textContent = displayName;
                option.appendChild(textSpan);

                option.addEventListener('mouseover', () => {
                    option.style.background = '#007acc';
                });

                option.addEventListener('mouseout', () => {
                    option.style.background = '';
                });

                option.addEventListener('click', () => {
                    condition.node_types = condition.node_types || [];
                    condition.node_types.push(nodeType);
                    searchInput.value = '';
                    updateSelectedDisplay();
                    filterDropdown('');
                    searchInput.focus();
                });

                dropdownList.appendChild(option);
            });

            dropdownList.style.display = 'block';
        };

        searchInput.addEventListener('focus', () => {
            filterDropdown(searchInput.value);
        });

        searchInput.addEventListener('input', () => {
            filterDropdown(searchInput.value);
        });

        searchInput.addEventListener('blur', () => {
            setTimeout(() => {
                dropdownList.style.display = 'none';
            }, 200);
        });

        updateSelectedDisplay();

        selectContainer.appendChild(searchInput);
        selectContainer.appendChild(dropdownList);

        container.appendChild(label);
        container.appendChild(selectedDisplay);
        container.appendChild(selectContainer);
    }

    createAttributeInWorkflowFields(container, condition) {
        const nodeTypeLabel = document.createElement('label');
        nodeTypeLabel.textContent = 'Node Type: ';
        nodeTypeLabel.style.display = 'block';
        nodeTypeLabel.style.marginBottom = '5px';

        // Node Type dropdown with search
        const nodeTypeContainer = document.createElement('div');
        nodeTypeContainer.style.cssText = `
            position: relative;
            width: 100%;
            margin-bottom: 10px;
        `;

        const nodeTypeInput = document.createElement('input');
        nodeTypeInput.type = 'text';
        nodeTypeInput.placeholder = 'Search node type...';
        nodeTypeInput.value = condition.node_type ? (this.nodeTypes[condition.node_type]?.display_name || condition.node_type) : '';
        nodeTypeInput.style.cssText = `
            width: 100%;
            padding: 5px;
            background: #2a2a2a;
            color: #fff;
            border: 1px solid #555;
            border-radius: 3px;
        `;

        const nodeTypeDropdown = document.createElement('div');
        nodeTypeDropdown.style.cssText = `
            position: absolute;
            width: 100%;
            max-height: 200px;
            overflow-y: auto;
            background: #2a2a2a;
            border: 1px solid #555;
            border-radius: 3px;
            z-index: 1000;
            display: none;
        `;

        // Get node types from workflow
        const workflowNodeTypes = new Set();
        if (app.graph && app.graph._nodes) {
            for (const node of app.graph._nodes) {
                workflowNodeTypes.add(node.type);
            }
        }

        const nodeTypesList = Object.keys(this.nodeTypes).sort();

        const filterNodeTypeDropdown = (searchTerm) => {
            nodeTypeDropdown.innerHTML = '';
            const lowerSearch = searchTerm.toLowerCase();

            const filtered = nodeTypesList.filter(nodeType => {
                const displayName = this.nodeTypes[nodeType]?.display_name || nodeType;
                return displayName.toLowerCase().includes(lowerSearch);
            });

            if (filtered.length === 0) {
                nodeTypeDropdown.style.display = 'none';
                return;
            }

            filtered.forEach(nodeType => {
                const option = document.createElement('div');
                option.style.cssText = `
                    padding: 8px;
                    cursor: pointer;
                    border-bottom: 1px solid #555;
                    display: flex;
                    align-items: center;
                    gap: 5px;
                `;

                // Add icon if in workflow
                if (workflowNodeTypes.has(nodeType)) {
                    const icon = document.createElement('span');
                    icon.textContent = '✓';
                    icon.style.color = '#0f0';
                    option.appendChild(icon);
                }

                const displayName = this.nodeTypes[nodeType]?.display_name || nodeType;
                const textSpan = document.createElement('span');
                textSpan.textContent = displayName;
                option.appendChild(textSpan);

                option.addEventListener('mouseover', () => {
                    option.style.background = '#007acc';
                });

                option.addEventListener('mouseout', () => {
                    option.style.background = '';
                });

                option.addEventListener('click', () => {
                    condition.node_type = nodeType;
                    nodeTypeInput.value = displayName;
                    nodeTypeDropdown.style.display = 'none';
                    // Refresh attribute dropdown
                    updateAttributeDropdown();
                });

                nodeTypeDropdown.appendChild(option);
            });

            nodeTypeDropdown.style.display = 'block';
        };

        nodeTypeInput.addEventListener('focus', () => {
            filterNodeTypeDropdown(nodeTypeInput.value);
        });

        nodeTypeInput.addEventListener('input', () => {
            filterNodeTypeDropdown(nodeTypeInput.value);
        });

        nodeTypeInput.addEventListener('blur', () => {
            setTimeout(() => {
                nodeTypeDropdown.style.display = 'none';
            }, 200);
        });

        nodeTypeContainer.appendChild(nodeTypeInput);
        nodeTypeContainer.appendChild(nodeTypeDropdown);

        // Attribute Name dropdown
        const attrLabel = document.createElement('label');
        attrLabel.textContent = 'Attribute Name: ';
        attrLabel.style.display = 'block';
        attrLabel.style.marginBottom = '5px';
        attrLabel.style.marginTop = '10px';

        const attrSelect = document.createElement('select');
        attrSelect.style.cssText = `
            width: 100%;
            padding: 5px;
            background: #2a2a2a;
            color: #fff;
            border: 1px solid #555;
            border-radius: 3px;
            margin-bottom: 10px;
        `;

        const updateAttributeDropdown = () => {
            attrSelect.innerHTML = '<option value="">Select attribute...</option>';

            if (condition.node_type && this.nodeTypes[condition.node_type]) {
                const attributes = this.nodeTypes[condition.node_type].attributes || {};
                Object.keys(attributes).forEach(attrName => {
                    const option = document.createElement('option');
                    option.value = attrName;
                    option.textContent = attrName;
                    if (condition.attribute_name === attrName) {
                        option.selected = true;
                    }
                    attrSelect.appendChild(option);
                });
            }
        };

        attrSelect.addEventListener('change', () => {
            condition.attribute_name = attrSelect.value || null;
        });

        updateAttributeDropdown();

        // Attribute Values
        const valuesLabel = document.createElement('label');
        valuesLabel.textContent = 'Attribute Values (comma-separated, optional): ';
        valuesLabel.style.display = 'block';
        valuesLabel.style.marginBottom = '5px';

        const valuesInput = document.createElement('input');
        valuesInput.type = 'text';
        valuesInput.value = (condition.attribute_values || []).join(', ');
        valuesInput.placeholder = 'e.g., value1, value2';
        valuesInput.style.cssText = `
            width: 100%;
            padding: 5px;
            background: #2a2a2a;
            color: #fff;
            border: 1px solid #555;
            border-radius: 3px;
        `;

        valuesInput.addEventListener('input', () => {
            condition.attribute_values = valuesInput.value.split(',').map(s => s.trim()).filter(s => s);
        });

        container.appendChild(nodeTypeLabel);
        container.appendChild(nodeTypeContainer);
        container.appendChild(attrLabel);
        container.appendChild(attrSelect);
        container.appendChild(valuesLabel);
        container.appendChild(valuesInput);
    }

    async saveCurrentNote() {
        if (!this.currentEditingNote) return false;

        // Clean up trigger conditions - remove null values
        const cleanedTriggerConditions = (this.currentTriggerConditions || []).map(tc => {
            const cleaned = { type: tc.type };
            if (tc.node_types !== null && tc.node_types !== undefined) cleaned.node_types = tc.node_types;
            if (tc.node_type !== null && tc.node_type !== undefined) cleaned.node_type = tc.node_type;
            if (tc.attribute_name !== null && tc.attribute_name !== undefined) cleaned.attribute_name = tc.attribute_name;
            if (tc.attribute_values !== null && tc.attribute_values !== undefined) cleaned.attribute_values = tc.attribute_values;
            if (tc.workflow_names !== null && tc.workflow_names !== undefined) cleaned.workflow_names = tc.workflow_names;
            return cleaned;
        });

        const data = {
            content: this.contentTextarea.value,
            format_style: this.formatSelect.value,
            pinned: this.pinnedCheckbox.checked,
            tags: this.currentTags || [],
            trigger_conditions: cleanedTriggerConditions
        };

        try {
            const response = await api.fetchApi(`/autonotes/notes/${this.currentEditingNote.uuid}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data),
            });

            const result = await response.json();
            if (result.success) {
                // Update local copy
                Object.assign(this.currentEditingNote, data);
                await this.refreshNotes();
                return true;
            } else {
                alert('Failed to save note');
                return false;
            }
        } catch (error) {
            console.error('Failed to save note:', error);
            alert('Failed to save note');
            return false;
        }
    }

    async closeEditDialog(save = false) {
        // Always auto-save if there are unsaved changes
        if (this.currentEditingNote && this.textareaChanged) {
            await this.saveCurrentNote();
            this.textareaChanged = false;
        } else if (save && this.currentEditingNote) {
            await this.saveCurrentNote();
        }

        // Remove global auto-save handler
        if (this.globalAutoSaveHandler) {
            document.removeEventListener('click', this.globalAutoSaveHandler, true);
            this.globalAutoSaveHandler = null;
        }

        if (this.editDialog) {
            this.editDialog.parentElement.remove(); // Remove overlay
            this.editDialog = null;
            this.currentEditingNote = null;
        }
    }

    async togglePin(note) {
        try {
            const newPinnedState = !note.pinned;
            const response = await api.fetchApi(`/autonotes/notes/${note.uuid}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    content: note.content,
                    format_style: note.format_style,
                    pinned: newPinnedState,
                    trigger_conditions: note.trigger_conditions || []
                }),
            });

            const result = await response.json();
            if (result.success) {
                note.pinned = newPinnedState;
                await this.refreshNotes();
            } else {
                alert('Failed to toggle pin');
            }
        } catch (error) {
            console.error('Failed to toggle pin:', error);
            alert('Failed to toggle pin');
        }
    }

    async addFolder(treeContainer, selectedNoteUuid) {
        const name = prompt('Enter folder name:');
        if (!name) return;

        try {
            const response = await api.fetchApi('/autonotes/folders', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name }),
            });

            const result = await response.json();
            if (result.uuid) {
                await this.loadFolders();
                this.renderNoteTree(treeContainer, selectedNoteUuid);
            }
        } catch (error) {
            console.error('Failed to create folder:', error);
            alert('Failed to create folder');
        }
    }

    async renameFolder(folder, treeContainer, selectedNoteUuid) {
        const newName = prompt('Enter new folder name:', folder.name);
        if (!newName || newName === folder.name) return;

        try {
            const response = await api.fetchApi(`/autonotes/folders/${folder.uuid}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name: newName }),
            });

            const result = await response.json();
            if (result.success) {
                await this.loadFolders();
                this.renderNoteTree(treeContainer, selectedNoteUuid);
            } else {
                alert('Failed to rename folder');
            }
        } catch (error) {
            console.error('Failed to rename folder:', error);
            alert('Failed to rename folder');
        }
    }

    async deleteFolder(folder, treeContainer, selectedNoteUuid) {
        if (!confirm(`Delete folder "${folder.name}"? Notes inside will not be deleted.`)) {
            return;
        }

        try {
            const response = await api.fetchApi(`/autonotes/folders/${folder.uuid}`, {
                method: 'DELETE',
            });

            const result = await response.json();
            if (result.success) {
                await this.loadFolders();
                this.renderNoteTree(treeContainer, selectedNoteUuid);
            } else {
                alert('Failed to delete folder');
            }
        } catch (error) {
            console.error('Failed to delete folder:', error);
            alert('Failed to delete folder');
        }
    }

    async moveNoteToFolder(noteUuid, folderUuid, treeContainer, selectedNoteUuid) {
        try {
            const response = await api.fetchApi(`/autonotes/notes/${noteUuid}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ folder_uuid: folderUuid }),
            });

            const result = await response.json();
            if (result.success) {
                await this.refreshNotes();
                this.renderNoteTree(treeContainer, selectedNoteUuid);
            } else {
                alert('Failed to move note');
            }
        } catch (error) {
            console.error('Failed to move note:', error);
            alert('Failed to move note');
        }
    }

    async moveFolderToFolder(folderUuid, parentFolderUuid, treeContainer, selectedNoteUuid) {
        try {
            // Prevent circular references
            if (folderUuid === parentFolderUuid) {
                alert('Cannot move a folder into itself');
                return;
            }

            // Check if parent is a descendant of the folder being moved
            const isDescendant = (checkFolderId, ancestorId) => {
                if (!checkFolderId) return false;
                if (checkFolderId === ancestorId) return true;
                const folder = this.folders.find(f => f.uuid === checkFolderId);
                if (!folder) return false;
                return isDescendant(folder.parent_uuid, ancestorId);
            };

            if (isDescendant(parentFolderUuid, folderUuid)) {
                alert('Cannot move a folder into its own descendant');
                return;
            }

            const response = await api.fetchApi(`/autonotes/folders/${folderUuid}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ parent_uuid: parentFolderUuid }),
            });

            const result = await response.json();
            if (result.success) {
                await this.loadFolders();
                this.renderNoteTree(treeContainer, selectedNoteUuid);
            } else {
                alert('Failed to move folder');
            }
        } catch (error) {
            console.error('Failed to move folder:', error);
            alert('Failed to move folder');
        }
    }

    showFolderContextMenu(event, folder, treeContainer, selectedNoteUuid) {
        // Remove any existing context menu
        const existingMenu = document.querySelector('.folder-context-menu');
        if (existingMenu) {
            existingMenu.remove();
        }

        const menu = document.createElement('div');
        menu.className = 'folder-context-menu';
        menu.style.cssText = `
            position: fixed;
            left: ${event.clientX}px;
            top: ${event.clientY}px;
            background: #2a2a2a;
            border: 1px solid #555;
            border-radius: 4px;
            padding: 5px 0;
            z-index: 10000;
            min-width: 150px;
            box-shadow: 0 4px 8px rgba(0,0,0,0.3);
        `;

        const createChildOption = document.createElement('div');
        createChildOption.textContent = 'New Child Folder';
        createChildOption.style.cssText = `
            padding: 8px 15px;
            cursor: pointer;
            color: #fff;
        `;
        createChildOption.addEventListener('mouseenter', () => {
            createChildOption.style.background = '#007acc';
        });
        createChildOption.addEventListener('mouseleave', () => {
            createChildOption.style.background = '';
        });
        createChildOption.addEventListener('click', async () => {
            menu.remove();
            const folderName = prompt('Enter folder name:');
            if (folderName) {
                await this.createFolderWithParent(folderName, folder.uuid, treeContainer, selectedNoteUuid);
            }
        });

        const renameOption = document.createElement('div');
        renameOption.textContent = 'Rename';
        renameOption.style.cssText = `
            padding: 8px 15px;
            cursor: pointer;
            color: #fff;
        `;
        renameOption.addEventListener('mouseenter', () => {
            renameOption.style.background = '#007acc';
        });
        renameOption.addEventListener('mouseleave', () => {
            renameOption.style.background = '';
        });
        renameOption.addEventListener('click', async () => {
            menu.remove();
            this.renameFolder(folder, treeContainer, selectedNoteUuid);
        });

        const deleteOption = document.createElement('div');
        deleteOption.textContent = 'Delete';
        deleteOption.style.cssText = `
            padding: 8px 15px;
            cursor: pointer;
            color: #f88;
        `;
        deleteOption.addEventListener('mouseenter', () => {
            deleteOption.style.background = '#007acc';
        });
        deleteOption.addEventListener('mouseleave', () => {
            deleteOption.style.background = '';
        });
        deleteOption.addEventListener('click', async () => {
            menu.remove();
            this.deleteFolder(folder, treeContainer, selectedNoteUuid);
        });

        menu.appendChild(createChildOption);
        menu.appendChild(renameOption);
        menu.appendChild(deleteOption);

        document.body.appendChild(menu);

        // Close menu when clicking outside
        const closeMenu = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };
        setTimeout(() => {
            document.addEventListener('click', closeMenu);
        }, 0);
    }

    async createFolderWithParent(name, parentUuid, treeContainer, selectedNoteUuid) {
        try {
            const response = await api.fetchApi('/autonotes/folders', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name, parent_uuid: parentUuid }),
            });

            const result = await response.json();
            if (result.uuid) {
                await this.loadFolders();
                // Expand the parent folder
                this.expandedFolders.add(parentUuid);
                this.renderNoteTree(treeContainer, selectedNoteUuid);
            }
        } catch (error) {
            console.error('Failed to create folder:', error);
            alert('Failed to create folder');
        }
    }

    showNoteContextMenu(event, note, treeContainer, selectedNoteUuid) {
        // Remove any existing context menu
        const existingMenu = document.querySelector('.note-context-menu');
        if (existingMenu) {
            existingMenu.remove();
        }

        const menu = document.createElement('div');
        menu.className = 'note-context-menu';
        menu.style.cssText = `
            position: fixed;
            left: ${event.clientX}px;
            top: ${event.clientY}px;
            background: #2a2a2a;
            border: 1px solid #555;
            border-radius: 4px;
            padding: 5px 0;
            z-index: 10000;
            min-width: 150px;
            box-shadow: 0 4px 8px rgba(0,0,0,0.3);
        `;

        const renameOption = document.createElement('div');
        renameOption.textContent = 'Rename';
        renameOption.style.cssText = `
            padding: 8px 15px;
            cursor: pointer;
            color: #fff;
        `;
        renameOption.addEventListener('mouseenter', () => {
            renameOption.style.background = '#007acc';
        });
        renameOption.addEventListener('mouseleave', () => {
            renameOption.style.background = '';
        });
        renameOption.addEventListener('click', async () => {
            menu.remove();
            const newName = prompt('Enter new note name:', note.name);
            if (newName && newName !== note.name) {
                await this.renameNote(note.uuid, newName, treeContainer, selectedNoteUuid);
            }
        });

        const duplicateOption = document.createElement('div');
        duplicateOption.textContent = 'Duplicate';
        duplicateOption.style.cssText = `
            padding: 8px 15px;
            cursor: pointer;
            color: #fff;
        `;
        duplicateOption.addEventListener('mouseenter', () => {
            duplicateOption.style.background = '#007acc';
        });
        duplicateOption.addEventListener('mouseleave', () => {
            duplicateOption.style.background = '';
        });
        duplicateOption.addEventListener('click', async () => {
            menu.remove();
            const newName = prompt('Enter name for duplicated note:', note.name);
            if (newName) {
                await this.duplicateNote(note.uuid, newName, treeContainer, selectedNoteUuid);
            }
        });

        const deleteOption = document.createElement('div');
        deleteOption.textContent = 'Delete';
        deleteOption.style.cssText = `
            padding: 8px 15px;
            cursor: pointer;
            color: #fff;
        `;
        deleteOption.addEventListener('mouseenter', () => {
            deleteOption.style.background = '#cc0000';
        });
        deleteOption.addEventListener('mouseleave', () => {
            deleteOption.style.background = '';
        });
        deleteOption.addEventListener('click', async () => {
            menu.remove();
            if (confirm(`Delete note "${note.name}"?`)) {
                await this.deleteNote(note.uuid, treeContainer, selectedNoteUuid);
            }
        });

        menu.appendChild(renameOption);
        menu.appendChild(duplicateOption);
        menu.appendChild(deleteOption);
        document.body.appendChild(menu);

        // Close menu when clicking outside
        const closeMenu = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };
        setTimeout(() => document.addEventListener('click', closeMenu), 0);
    }

    async renameNote(noteUuid, newName, treeContainer, selectedNoteUuid) {
        try {
            const response = await api.fetchApi(`/autonotes/notes/${noteUuid}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name: newName }),
            });

            const result = await response.json();
            if (result.success) {
                await this.refreshNotes();
                this.renderNoteTree(treeContainer, selectedNoteUuid);
            } else {
                alert('Failed to rename note');
            }
        } catch (error) {
            console.error('Failed to rename note:', error);
            alert('Failed to rename note');
        }
    }

    async deleteNote(noteUuid, treeContainer, selectedNoteUuid) {
        try {
            const response = await api.fetchApi(`/autonotes/notes/${noteUuid}`, {
                method: 'DELETE',
            });

            const result = await response.json();
            if (result.success) {
                await this.refreshNotes();
                this.renderNoteTree(treeContainer, selectedNoteUuid);
                // Clear editor if deleted note was being edited
                if (this.currentEditingNote && this.currentEditingNote.uuid === noteUuid) {
                    this.currentEditingNote = null;
                    if (this.contentTextarea) {
                        this.contentTextarea.value = '';
                    }
                }
            } else {
                alert('Failed to delete note');
            }
        } catch (error) {
            console.error('Failed to delete note:', error);
            alert('Failed to delete note');
        }
    }

    async duplicateNote(noteUuid, newName, treeContainer, selectedNoteUuid) {
        try {
            // Get the original note
            const originalNote = this.notes.find(n => n.uuid === noteUuid);
            if (!originalNote) {
                alert('Note not found');
                return;
            }

            // Create a new note with the same folder
            const response = await api.fetchApi('/autonotes/notes', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    name: newName,
                    folder_uuid: originalNote.folder_uuid
                }),
            });

            const noteResult = await response.json();
            if (noteResult.uuid) {
                // Update the new note with all properties from the original
                await api.fetchApi(`/autonotes/notes/${noteResult.uuid}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        content: originalNote.content,
                        format_style: originalNote.format_style,
                        pinned: false, // Don't duplicate the pinned state
                        tags: [...(originalNote.tags || [])],
                        trigger_conditions: [...(originalNote.trigger_conditions || [])]
                    }),
                });

                await this.refreshNotes();
                if (treeContainer) {
                    this.renderNoteTree(treeContainer, selectedNoteUuid);
                }
            }
        } catch (error) {
            console.error('Failed to duplicate note:', error);
            alert('Failed to duplicate note');
        }
    }

    showSidebarNoteContextMenu(event, note) {
        // Remove any existing context menu
        const existingMenu = document.querySelector('.sidebar-note-context-menu');
        if (existingMenu) {
            existingMenu.remove();
        }

        const menu = document.createElement('div');
        menu.className = 'sidebar-note-context-menu';
        menu.style.cssText = `
            position: fixed;
            left: ${event.clientX}px;
            top: ${event.clientY}px;
            background: #2a2a2a;
            border: 1px solid #555;
            border-radius: 4px;
            padding: 5px 0;
            z-index: 10000;
            min-width: 150px;
            box-shadow: 0 4px 8px rgba(0,0,0,0.3);
        `;

        const editOption = document.createElement('div');
        editOption.textContent = 'Edit';
        editOption.style.cssText = `
            padding: 8px 15px;
            cursor: pointer;
            color: #fff;
        `;
        editOption.addEventListener('mouseenter', () => {
            editOption.style.background = '#007acc';
        });
        editOption.addEventListener('mouseleave', () => {
            editOption.style.background = '';
        });
        editOption.addEventListener('click', async () => {
            menu.remove();
            await this.openEditDialog(note.uuid);
        });

        const duplicateOption = document.createElement('div');
        duplicateOption.textContent = 'Duplicate';
        duplicateOption.style.cssText = `
            padding: 8px 15px;
            cursor: pointer;
            color: #fff;
        `;
        duplicateOption.addEventListener('mouseenter', () => {
            duplicateOption.style.background = '#007acc';
        });
        duplicateOption.addEventListener('mouseleave', () => {
            duplicateOption.style.background = '';
        });
        duplicateOption.addEventListener('click', async () => {
            menu.remove();
            const newName = prompt('Enter name for duplicated note:', note.name);
            if (newName) {
                await this.duplicateNote(note.uuid, newName, null, null);
            }
        });

        const deleteOption = document.createElement('div');
        deleteOption.textContent = 'Delete';
        deleteOption.style.cssText = `
            padding: 8px 15px;
            cursor: pointer;
            color: #f88;
        `;
        deleteOption.addEventListener('mouseenter', () => {
            deleteOption.style.background = '#cc0000';
        });
        deleteOption.addEventListener('mouseleave', () => {
            deleteOption.style.background = '';
        });
        deleteOption.addEventListener('click', async () => {
            menu.remove();
            if (confirm(`Delete note "${note.name}"?`)) {
                try {
                    const response = await api.fetchApi(`/autonotes/notes/${note.uuid}`, {
                        method: 'DELETE',
                    });

                    const result = await response.json();
                    if (result.success) {
                        await this.refreshNotes();
                    } else {
                        alert('Failed to delete note');
                    }
                } catch (error) {
                    console.error('Failed to delete note:', error);
                    alert('Failed to delete note');
                }
            }
        });

        menu.appendChild(editOption);
        menu.appendChild(duplicateOption);
        menu.appendChild(deleteOption);
        document.body.appendChild(menu);

        // Close menu when clicking outside
        const closeMenu = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };
        setTimeout(() => document.addEventListener('click', closeMenu), 0);
    }

    async updateNoteContent(noteUuid, content) {
        try {
            const response = await api.fetchApi(`/autonotes/notes/${noteUuid}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ content }),
            });

            const result = await response.json();
            if (result.success) {
                // Refresh to show updated content
                await this.refreshNotes();
            } else {
                alert('Failed to save note');
            }
        } catch (error) {
            console.error('Failed to save note:', error);
            alert('Failed to save note');
        }
    }

    async updateNoteTags(note) {
        try {
            const response = await api.fetchApi(`/autonotes/notes/${note.uuid}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    content: note.content,
                    format_style: note.format_style,
                    pinned: note.pinned,
                    tags: note.tags || [],
                    trigger_conditions: note.trigger_conditions || []
                }),
            });

            const result = await response.json();
            if (result.success) {
                await this.refreshNotes();
            } else {
                alert('Failed to update tags');
            }
        } catch (error) {
            console.error('Failed to update tags:', error);
            alert('Failed to update tags');
        }
    }
}

// Initialize the AutoNotes manager when the extension loads
app.registerExtension({
    name: "AutoNotes",
    async setup() {
        new AutoNotesManager();
    },
});