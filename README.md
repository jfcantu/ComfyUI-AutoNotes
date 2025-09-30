# ComfyUI-AutoNotes

An intelligent note-taking extension for ComfyUI that automatically displays relevant notes based on your workflow context.

## Features

- **Smart Note Display**: Notes automatically appear based on trigger conditions like selected nodes, node attributes, or workflow names
- **Sidebar Interface**: Non-intrusive sidebar that doesn't interfere with your workflow
- **Multiple Display Modes**:
  - "All" mode shows all notes
  - "Automatic" mode shows only relevant notes based on triggers
- **Rich Formatting**: Support for both plaintext and Markdown formatting
- **Trigger Conditions**: Configure when notes should appear:
  - **Node Selected**: Show notes when specific node types are selected
  - **Node Attribute**: Show notes when nodes have specific attribute values
  - **Workflow Name**: Show notes when workflow filename contains specific text
- **Pinnable Notes**: Pin important notes to always display regardless of context
- **Organized Storage**: Notes stored in your ComfyUI user directory with UUID-based organization
- **Edit Dialog**: Full-featured editor with tree view and trigger condition management

## Installation

1. Clone or download this repository into your ComfyUI `custom_nodes` directory:

   ```
   cd ComfyUI/custom_nodes
   git clone https://github.com/yourusername/ComfyUI-AutoNotes.git
   ```

2. Restart ComfyUI

3. The AutoNotes sidebar will appear on the right side of your ComfyUI interface

## Usage

### Basic Operations

1. **Creating Notes**: Click the "Add" button in the sidebar control panel
2. **Editing Notes**: Click the "Edit" button to open the full editor dialog
3. **Display Modes**: Switch between "All" and "Automatic" in the dropdown

### Setting Up Trigger Conditions

In the Edit dialog, you can configure when notes should automatically appear:

#### Node Selected Trigger

- Displays the note when any of the specified node types is selected
- Example: `CheckpointLoaderSimple, LoraLoader`

#### Node Attribute Trigger

- Displays the note when a specific node has certain attribute values
- Useful for showing notes about specific models or settings
- Example:
  - Node Type: `CheckpointLoaderSimple`
  - Attribute Name: `ckpt_name`
  - Attribute Values: `mymodel.safetensors, specialmodel.ckpt`

#### Workflow Name Trigger

- Displays the note when the workflow filename contains specific text
- Example: `portrait, character, anime`

### Example Use Cases

1. **Model-Specific Notes**: Create notes with tips about specific checkpoints that appear when you select them
2. **Node Documentation**: Add usage instructions that appear when you select certain node types
3. **Workflow Reminders**: Set up notes that remind you of important settings for specific types of workflows
4. **Quick Reference**: Pin frequently-used information to always stay visible

### Data Storage

Notes are stored in your ComfyUI user directory under `autonotes/`:

- `notes.json`: Contains all note data and metadata
- `folders.json`: Contains folder organization (future feature)

## Technical Details

### File Structure

```text
ComfyUI-AutoNotes/
├── __init__.py              # Extension entry point
├── autonotes.py            # Main Python backend
├── web/
│   └── autonotes.js        # Frontend JavaScript
├── README.md               # This file
└── requirements.md         # Original requirements document
```

### API Endpoints

The extension exposes REST API endpoints for note management:

- `GET /autonotes/notes` - Retrieve notes with filtering
- `POST /autonotes/notes` - Create new note
- `PUT /autonotes/notes/{uuid}` - Update existing note
- `DELETE /autonotes/notes/{uuid}` - Delete note
- `GET /autonotes/folders` - Retrieve folders
- `POST /autonotes/folders` - Create new folder

### Data Models

**Note Structure**:

```json
{
  "uuid": "unique-identifier",
  "folder_uuid": "parent-folder-id",
  "name": "Note Title",
  "content": "Note content...",
  "format_style": "plaintext|markdown",
  "pinned": true|false,
  "trigger_conditions": [...]
}
```

**Trigger Condition Structure**:

```json
{
  "type": "node_selected|node_attribute|workflow_name",
  "node_types": ["NodeType1", "NodeType2"],
  "node_type": "SpecificNodeType",
  "attribute_name": "attribute_name",
  "attribute_values": ["value1", "value2"],
  "workflow_names": ["name1", "name2"]
}
```

## Development

The extension follows ComfyUI's standard custom node structure:

- Python backend handles data management and API endpoints
- JavaScript frontend provides the user interface
- Uses ComfyUI's built-in web server and extension system

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly with ComfyUI
5. Submit a pull request
