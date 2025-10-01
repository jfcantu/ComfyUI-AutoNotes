import os
import json
import uuid
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, asdict
import folder_paths
from server import PromptServer
from aiohttp import web


@dataclass
class TriggerCondition:
    type: str  # "node_selected", "node_selected_attribute", "node_in_workflow", "node_in_workflow_attribute", "workflow_name"
    node_types: Optional[List[str]] = None
    node_type: Optional[str] = None
    attribute_name: Optional[str] = None
    attribute_values: Optional[List[str]] = None
    workflow_names: Optional[List[str]] = None


@dataclass
class Note:
    uuid: str
    folder_uuid: Optional[str]
    content: str
    format_style: str  # "plaintext" or "markdown"
    trigger_conditions: List[TriggerCondition]
    pinned: bool = False
    name: str = ""
    tags: List[str] = None

    def __post_init__(self):
        if self.tags is None:
            self.tags = []


@dataclass
class Folder:
    uuid: str
    parent_uuid: Optional[str]
    name: str


class AutoNotesManager:
    def __init__(self, user: str = "default"):
        self.user = user
        self.user_dir = folder_paths.get_user_directory()
        # Store data in user-specific subdirectory (e.g., user/default/autonotes)
        self.data_dir = os.path.join(self.user_dir, user, "autonotes")
        self.notes_file = os.path.join(self.data_dir, "notes.json")
        self.folders_file = os.path.join(self.data_dir, "folders.json")

        # Ensure data directory exists
        os.makedirs(self.data_dir, exist_ok=True)

        # Load existing data
        self.notes: Dict[str, Note] = self._load_notes()
        self.folders: Dict[str, Folder] = self._load_folders()

    def _load_notes(self) -> Dict[str, Note]:
        if os.path.exists(self.notes_file):
            try:
                with open(self.notes_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    notes = {}
                    for note_data in data:
                        # Convert trigger conditions
                        trigger_conditions = []
                        for tc_data in note_data.get('trigger_conditions', []):
                            trigger_conditions.append(TriggerCondition(**tc_data))

                        note_data['trigger_conditions'] = trigger_conditions
                        note = Note(**note_data)
                        notes[note.uuid] = note
                    return notes
            except Exception as e:
                print(f"AutoNotes: Error loading notes: {e}")
        return {}

    def _load_folders(self) -> Dict[str, Folder]:
        if os.path.exists(self.folders_file):
            try:
                with open(self.folders_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    folders = {}
                    for folder_data in data:
                        folder = Folder(**folder_data)
                        folders[folder.uuid] = folder
                    return folders
            except Exception as e:
                print(f"AutoNotes: Error loading folders: {e}")
        return {}

    def _save_notes(self):
        try:
            data = []
            for note in self.notes.values():
                note_dict = asdict(note)
                # Convert trigger conditions to dict
                note_dict['trigger_conditions'] = [asdict(tc) for tc in note.trigger_conditions]
                data.append(note_dict)

            with open(self.notes_file, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"AutoNotes: Error saving notes: {e}")

    def _save_folders(self):
        try:
            data = [asdict(folder) for folder in self.folders.values()]
            with open(self.folders_file, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"AutoNotes: Error saving folders: {e}")

    def create_note(self, name: str, folder_uuid: Optional[str] = None) -> str:
        note_uuid = str(uuid.uuid4())
        note = Note(
            uuid=note_uuid,
            folder_uuid=folder_uuid,
            content="",
            format_style="plaintext",
            trigger_conditions=[],
            name=name
        )
        self.notes[note_uuid] = note
        self._save_notes()
        return note_uuid

    def update_note(self, note_uuid: str, **kwargs) -> bool:
        if note_uuid not in self.notes:
            return False

        note = self.notes[note_uuid]
        for key, value in kwargs.items():
            if hasattr(note, key):
                setattr(note, key, value)

        self._save_notes()
        return True

    def delete_note(self, note_uuid: str) -> bool:
        if note_uuid in self.notes:
            del self.notes[note_uuid]
            self._save_notes()
            return True
        return False

    def create_folder(self, name: str, parent_uuid: Optional[str] = None) -> str:
        folder_uuid = str(uuid.uuid4())
        folder = Folder(
            uuid=folder_uuid,
            parent_uuid=parent_uuid,
            name=name
        )
        self.folders[folder_uuid] = folder
        self._save_folders()
        return folder_uuid

    def get_notes_for_display(self, mode: str = "all", selected_node_type: Optional[str] = None,
                            selected_node_attributes: Optional[Dict[str, Any]] = None,
                            workflow_name: Optional[str] = None,
                            workflow_nodes: Optional[Dict[str, Any]] = None) -> List[Note]:
        if mode == "all":
            return list(self.notes.values())

        # Automatic mode - filter by trigger conditions
        matching_notes = []

        for note in self.notes.values():
            if note.pinned:
                matching_notes.append(note)
                continue

            for condition in note.trigger_conditions:
                if self._check_trigger_condition(condition, selected_node_type,
                                               selected_node_attributes, workflow_name,
                                               workflow_nodes):
                    matching_notes.append(note)
                    break

        return matching_notes

    def _check_trigger_condition(self, condition: TriggerCondition,
                               selected_node_type: Optional[str],
                               selected_node_attributes: Optional[Dict[str, Any]],
                               workflow_name: Optional[str],
                               workflow_nodes: Optional[Dict[str, Any]] = None) -> bool:
        if condition.type == "node_selected":
            return (selected_node_type is not None and
                   condition.node_types is not None and
                   selected_node_type in condition.node_types)

        elif condition.type == "node_selected_attribute":
            if (selected_node_type == condition.node_type and
                selected_node_attributes is not None and
                condition.attribute_name in selected_node_attributes and
                condition.attribute_values is not None):

                attr_value = str(selected_node_attributes[condition.attribute_name])
                return any(val in attr_value for val in condition.attribute_values)

        elif condition.type == "node_in_workflow":
            if workflow_nodes is not None and condition.node_types is not None:
                # Check if any of the specified node types exist in the workflow
                return any(node_type in workflow_nodes for node_type in condition.node_types)

        elif condition.type == "node_in_workflow_attribute":
            if (workflow_nodes is not None and
                condition.node_type is not None and
                condition.attribute_name is not None):

                # Check if the node type exists and has the specified attribute
                if condition.node_type in workflow_nodes:
                    node_attrs = workflow_nodes[condition.node_type]
                    if condition.attribute_name in node_attrs:
                        # If attribute_values is specified, check if any match
                        if condition.attribute_values is not None and len(condition.attribute_values) > 0:
                            attr_value = str(node_attrs[condition.attribute_name])
                            return any(val in attr_value for val in condition.attribute_values)
                        else:
                            # No specific values required, just presence is enough
                            return True

        elif condition.type == "workflow_name":
            if workflow_name is not None and condition.workflow_names is not None:
                return any(name in workflow_name for name in condition.workflow_names)

        return False


# Global manager instance
# Helper function to get user from request
def get_user_from_request(request) -> str:
    """Get the user ID from the request headers, defaulting to 'default'."""
    user = "default"
    if "comfy-user" in request.headers:
        user = request.headers["comfy-user"]

    # If user is empty or None, use "default"
    if not user:
        user = "default"

    return user


# Helper function to get manager for request
def get_manager_for_request(request) -> AutoNotesManager:
    """Get a user-specific AutoNotesManager instance based on the request."""
    user = get_user_from_request(request)
    return AutoNotesManager(user)


class AutoNotesNode:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {},
        }

    RETURN_TYPES = ()
    FUNCTION = "process"
    OUTPUT_NODE = True
    CATEGORY = "AutoNotes"

    def process(self):
        # This node doesn't actually process anything in the workflow
        # It's just here to provide a presence in the node list
        return {}


# Web API routes
@PromptServer.instance.routes.get("/autonotes/notes")
async def get_notes(request):
    try:
        manager = get_manager_for_request(request)
        mode = request.query.get('mode', 'all')
        selected_node_type = request.query.get('node_type')
        workflow_name = request.query.get('workflow_name')

        # Parse node attributes if provided
        selected_node_attributes = None
        if 'node_attributes' in request.query:
            try:
                selected_node_attributes = json.loads(request.query['node_attributes'])
            except:
                pass

        # Parse workflow nodes if provided
        workflow_nodes = None
        if 'workflow_nodes' in request.query:
            try:
                workflow_nodes = json.loads(request.query['workflow_nodes'])
            except:
                pass

        notes = manager.get_notes_for_display(
            mode=mode,
            selected_node_type=selected_node_type,
            selected_node_attributes=selected_node_attributes,
            workflow_name=workflow_name,
            workflow_nodes=workflow_nodes
        )

        # Convert notes to JSON-serializable format
        notes_data = []
        for note in notes:
            note_dict = asdict(note)
            note_dict['trigger_conditions'] = [asdict(tc) for tc in note.trigger_conditions]
            notes_data.append(note_dict)

        return web.json_response(notes_data)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


@PromptServer.instance.routes.post("/autonotes/notes")
async def create_note(request):
    try:
        manager = get_manager_for_request(request)
        data = await request.json()
        name = data.get('name', 'New Note')
        folder_uuid = data.get('folder_uuid')

        note_uuid = manager.create_note(name, folder_uuid)
        return web.json_response({"uuid": note_uuid})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


@PromptServer.instance.routes.put("/autonotes/notes/{note_uuid}")
async def update_note(request):
    try:
        manager = get_manager_for_request(request)
        note_uuid = request.match_info['note_uuid']
        data = await request.json()

        # Handle trigger conditions conversion
        if 'trigger_conditions' in data:
            trigger_conditions = []
            for tc_data in data['trigger_conditions']:
                trigger_conditions.append(TriggerCondition(**tc_data))
            data['trigger_conditions'] = trigger_conditions

        success = manager.update_note(note_uuid, **data)
        return web.json_response({"success": success})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


@PromptServer.instance.routes.delete("/autonotes/notes/{note_uuid}")
async def delete_note(request):
    try:
        manager = get_manager_for_request(request)
        note_uuid = request.match_info['note_uuid']
        success = manager.delete_note(note_uuid)
        return web.json_response({"success": success})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


@PromptServer.instance.routes.get("/autonotes/folders")
async def get_folders(request):
    try:
        manager = get_manager_for_request(request)
        folders_data = [asdict(folder) for folder in manager.folders.values()]
        return web.json_response(folders_data)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


@PromptServer.instance.routes.post("/autonotes/folders")
async def create_folder(request):
    try:
        manager = get_manager_for_request(request)
        data = await request.json()
        name = data.get('name', 'New Folder')
        parent_uuid = data.get('parent_uuid')

        folder_uuid = manager.create_folder(name, parent_uuid)
        return web.json_response({"uuid": folder_uuid})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


@PromptServer.instance.routes.put("/autonotes/folders/{folder_uuid}")
async def update_folder(request):
    try:
        manager = get_manager_for_request(request)
        folder_uuid = request.match_info['folder_uuid']
        data = await request.json()

        if folder_uuid not in manager.folders:
            return web.json_response({"success": False, "error": "Folder not found"}, status=404)

        folder = manager.folders[folder_uuid]
        if 'name' in data:
            folder.name = data['name']
        if 'parent_uuid' in data:
            folder.parent_uuid = data['parent_uuid']

        manager._save_folders()
        return web.json_response({"success": True})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


@PromptServer.instance.routes.delete("/autonotes/folders/{folder_uuid}")
async def delete_folder(request):
    try:
        manager = get_manager_for_request(request)
        folder_uuid = request.match_info['folder_uuid']

        if folder_uuid not in manager.folders:
            return web.json_response({"success": False, "error": "Folder not found"}, status=404)

        # Remove folder_uuid from any notes that reference it
        for note in manager.notes.values():
            if note.folder_uuid == folder_uuid:
                note.folder_uuid = None
        manager._save_notes()

        # Delete the folder
        del manager.folders[folder_uuid]
        manager._save_folders()

        return web.json_response({"success": True})
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)


# Node mappings
NODE_CLASS_MAPPINGS = {
    "AutoNotesNode": AutoNotesNode
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "AutoNotesNode": "Auto Notes"
}

# Web directory for frontend files
WEB_DIRECTORY = "./web"