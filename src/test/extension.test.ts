import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { GPreviewEditorProvider } from '../extension';

const editorProvider = new GPreviewEditorProvider({} as vscode.ExtensionContext);

suite('Extension Test Suite', function () {
	this.timeout("60s");
	vscode.window.showInformationMessage('Start all tests.');

	test('Converting `Almost Blank.vi` into HTML', async () => {
		await assert.doesNotReject(async () => {
			await editorProvider.convertViToHtml('../../gpreview-labview/Test Cases/Almost Blank.vi');
		});
	});

	test('Converting `ControllerWorkerPattern 1.vi` into HTML', async () => {
		await assert.doesNotReject(async () => {
			await editorProvider.convertViToHtml('../../gpreview-labview/Test Cases/ControllerWorkerPattern 1.vi');
		});
	});

	test('Converting `Many Nested Cases.vi` into HTML', async () => {
		await assert.doesNotReject(async () => {
			await editorProvider.convertViToHtml('../../gpreview-labview/Test Cases/Many Nested Cases.vi');
		});
	});
});
