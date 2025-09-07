# odoo-auto-manifest-init

**odoo-auto-manifest-init** is a Visual Studio Code extension that helps you automate updates to Odoo module manifests (`__manifest__.py`) and Python `__init__.py` for models, wizard, and controllers folders. This extension makes it easy for Odoo developers to keep manifests and init files tidy and properly sorted every time new files are created or deleted.

---

## Features

- **Setup Panel:**  
  Easily select your module, views, wizard, controllers, data, security, and models folders through a simple GUI panel.
- **Enable/Disable Extension:**  
  Quickly enable or disable the extension features from the setup panel.
- **Automatic Manifest & Init Updates:**  
  XML files created or deleted in the views, wizard, data, or security folders are automatically added or commented out in `__manifest__.py` in alphabetical order.
- **Automatic Python Imports:**  
  Python files created or deleted in the models, wizard, and controllers folders are automatically added or commented out in `__init__.py`, sorted alphabetically.
- **Append-Only, Not Rewrite:**  
  Only the necessary lines are inserted in the right order; the entire file is never rewritten.
- **Supports various Odoo folder structures:**  
  Works with any Odoo project structure as long as the paths are configured in the setup panel.

---

## Requirements

- Visual Studio Code v1.60 or later.
- Your Odoo project should have the standard structure (`__manifest__.py`, models, views, etc).
- No additional external dependencies.

---

## Extension Settings

This extension does **not** add any settings to the VSCode Settings menu. All configuration (paths & enable/disable) is handled through the setup panel.

---

## How To Use

1. Run the `Odoo: Show Manifest & Init Setup Panel` command from the Command Palette (`Ctrl+Shift+P`).
2. Fill in all the folder paths in the setup panel.
3. Check "Enable Extension" to activate automatic watchers.
4. Click Save.
5. The extension will now automatically update your manifest and init files as you create or delete files.

---

## Known Issues

- If you change folder paths after the initial setup, please re-run the setup panel and update your configuration.
- The extension only works in the workspace where it was configured.
- If there are non-standard import lines in `__init__.py`, alphabetical sorting may not be perfect.

---

Happy coding with Odoo!