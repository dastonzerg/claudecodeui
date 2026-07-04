import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sessionItemSource = readFileSync(
  new URL('./SidebarSessionItem.tsx', import.meta.url),
  'utf8',
);
const projectItemSource = readFileSync(
  new URL('./SidebarProjectItem.tsx', import.meta.url),
  'utf8',
);
const indexCssSource = readFileSync(new URL('../../../../index.css', import.meta.url), 'utf8');

test('mobile session rows expose inline title editing controls', () => {
  const mobileBranch = sessionItemSource.slice(
    sessionItemSource.indexOf('<div className="md:hidden">'),
    sessionItemSource.indexOf('<a'),
  );

  assert.match(mobileBranch, /onStartEditingSession\(session\.id, sessionView\.sessionName\)/);
  assert.match(mobileBranch, /type="text"/);
  assert.match(mobileBranch, /sidebar-title-edit-input/);
  assert.match(mobileBranch, /onClick=\{isEditing \? undefined : selectMobileSession\}/);
  assert.match(mobileBranch, /onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(mobileBranch, /onTouchStart=\{\(event\) => event\.stopPropagation\(\)\}/);
});

test('sidebar rename inputs allow native mobile text selection', () => {
  assert.match(projectItemSource, /sidebar-title-edit-input/);
  assert.match(projectItemSource, /onClick=\{isEditing \? undefined : toggleProject\}/);
  assert.match(projectItemSource, /onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(projectItemSource, /onTouchStart=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(indexCssSource, /\.sidebar-title-edit-input/);
  assert.match(indexCssSource, /-webkit-user-select:\s*text\s*!important/);
  assert.match(indexCssSource, /-webkit-touch-callout:\s*default\s*!important/);
  assert.match(indexCssSource, /touch-action:\s*auto\s*!important/);
});
