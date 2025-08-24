import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { GPreviewDocument } from '../extension';

suite('Extension Test Suite', function () {
	this.timeout("60s");
	vscode.window.showInformationMessage('Start all tests.');

	let testFiles = [
		"1D Array Last Element.vim",
		"Almost Blank.vi",
		"Completely Blank.vi",
		"ControllerWorkerPattern.vit",
		"Many Nested Cases.vi"
	];

	testFiles.forEach(testFile => {
		test(`Converting '${testFile}' into HTML`, async () => {
			await assert.doesNotReject(async () => {
				await GPreviewDocument.convertViToHtml(`../../gpreview-labview/Test Cases/${testFile}`);
			});
		});
	});
});
