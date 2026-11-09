import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NotesWidget } from './NotesWidget';
import { useNotesStore } from '../../store/notesStore';

function seed(rendered = false, content = '') {
  useNotesStore.setState({
    notes: [
      { id: 'a', title: 'One', content },
      { id: 'b', title: 'Two', content: '' },
      { id: 'c', title: 'Three', content: '' },
    ],
    activeId: 'a',
    rendered,
  });
}

beforeEach(() => {
  seed();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0; });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('NotesWidget tabs', () => {
  it('moves selection and focus with arrows, Home and End; roving tabindex follows', () => {
    render(<NotesWidget />);
    const tab = (name: string) => screen.getByRole('tab', { name: new RegExp(name) });
    tab('One').focus();
    fireEvent.keyDown(tab('One'), { key: 'ArrowRight' });
    expect(useNotesStore.getState().activeId).toBe('b');
    expect(document.activeElement).toBe(tab('Two'));
    expect(tab('Two').tabIndex).toBe(0);
    expect(tab('One').tabIndex).toBe(-1);
    fireEvent.keyDown(tab('Two'), { key: 'End' });
    expect(useNotesStore.getState().activeId).toBe('c');
    fireEvent.keyDown(tab('Three'), { key: 'ArrowRight' });
    expect(useNotesStore.getState().activeId).toBe('a');
    fireEvent.keyDown(tab('One'), { key: 'ArrowLeft' });
    expect(useNotesStore.getState().activeId).toBe('c');
    fireEvent.keyDown(tab('Three'), { key: 'Home' });
    expect(useNotesStore.getState().activeId).toBe('a');
  });

  it('keeps the delete button outside the tab element', () => {
    render(<NotesWidget />);
    const del = screen.getByRole('button', { name: 'Delete note' });
    expect(del.closest('[role="tab"]')).toBeNull();
  });
});

describe('NotesWidget preview links', () => {
  it('opens https links externally and swallows relative ones', () => {
    const openExternal = vi.fn();
    vi.stubGlobal('electron', { openExternal });
    (window as unknown as { electron: unknown }).electron = { openExternal };
    seed(true, '[web](https://example.com) [rel](todo.md)');
    render(<NotesWidget />);
    const web = screen.getByText('web');
    const rel = screen.getByText('rel');
    expect(fireEvent.click(web)).toBe(false);
    expect(openExternal).toHaveBeenCalledWith('https://example.com');
    openExternal.mockClear();
    expect(fireEvent.click(rel)).toBe(false);
    expect(openExternal).not.toHaveBeenCalled();
    act(() => { delete (window as unknown as { electron?: unknown }).electron; });
  });
});
