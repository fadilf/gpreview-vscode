# GPreview VS Code

GPreview VS Code is a tool that let's you preview LabVIEW code inside Visual Studio Code. Behind the scenes, it uses a tool that you can download separately to export interactive HTML previews of LabVIEW code.

**Note: You must have LabVIEW 2019 or later installed to use this tool.**

[Extension](https://marketplace.visualstudio.com/items?itemName=fadil.gpreview) | [GitHub Repo](https://github.com/fadilf/gpreview-vscode)

## Features

![GPreview VS Code Demo](images/GPreview%20Demo.webp)

- Preview LabVIEW files inside VS Code
- Explore case structures and other multi-frame structures
- More interactive than LabVIEW's printing of VIs

## Requirements

- LabVIEW 2019 or later
    - LabVIEW Command Line Interface
    - VI server enabled
    - [JDP Science Common Utilities](https://www.vipm.io/package/jdp_science_lib_common_utilities/) installed

## Extension Settings

This extension contributes the following settings:

* `gpreview.viServerPort`: Specifies the LabVIEW VI server port to use (default: 3363).
* `gpreview.labViewFilePath`: Specifies the LabVIEW executable file path to use (default: empty).

## Known Issues

None yet but please report any you experience as an issue here: [fadilf/gpreview-vscode](https://github.com/fadilf/gpreview-vscode)