# GPreview VS Code

GPreview VS Code is a tool that let's you preview LabVIEW code inside Visual Studio Code. Behind the scenes, it uses a tool that you can download separately to export interactive HTML previews of LabVIEW code.

[Link to the VS Code extension](https://marketplace.visualstudio.com/items?itemName=fadil.gpreview)

## Features

![GPreview VS Code Demo](images/GPreview%20Demo.webp)

- Preview LabVIEW files inside VS Code
- Explore case structures and other multi-frame structures
- More interactive than LabVIEW's printing of VIs

## Requirements

You must have LabVIEW 2019 or later installed to use this tool.

## Extension Settings

This extension contributes the following settings:

* `gpreview.viServerPort`: Specifies the LabVIEW VI server port to use (default: 3363).
* `gpreview.labViewFilePath`: Specifies the LabVIEW executable file path to use (default: empty).

## Known Issues

None yet but please report any you experience as an issue here: [fadilf/gpreview-vscode](https://github.com/fadilf/gpreview-vscode)

## Release Notes

### 0.0.5

Move LV save version to 2019

### 0.0.4

Move VI rendering to Document class
Add support for viewing files in workspace state outisde of filesystem
Add border around preview

### 0.0.3

Support for front panel preview added and better port argument handling

### 0.0.2

Minor bug fixes

### 0.0.1

Initial release of GPreview

---