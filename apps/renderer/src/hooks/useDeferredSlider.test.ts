import { act, renderHook } from '@testing-library/react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDeferredSlider } from './useDeferredSlider';

const change = (v: number) => ({ target: { value: String(v) } }) as unknown as ChangeEvent<HTMLInputElement>;
const key = (k: string) => ({ key: k }) as KeyboardEvent<HTMLInputElement>;

describe('useDeferredSlider', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('commits on keyup for arrow keys', () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useDeferredSlider(10, onCommit));
    act(() => result.current.sliderProps.onChange(change(20)));
    act(() => result.current.sliderProps.onKeyUp(key('ArrowRight')));
    expect(onCommit).toHaveBeenCalledWith(20);
    act(() => { vi.advanceTimersByTime(500); });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('ignores keyup for non-slider keys', () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useDeferredSlider(10, onCommit));
    act(() => result.current.sliderProps.onKeyUp(key('Tab')));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('commits a change debounced when no pointer is down', () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useDeferredSlider(10, onCommit));
    act(() => result.current.sliderProps.onChange(change(30)));
    expect(onCommit).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(300); });
    expect(onCommit).toHaveBeenCalledWith(30);
  });

  it('does not debounce-commit during a pointer drag, commits on pointer up', () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useDeferredSlider(10, onCommit));
    act(() => result.current.sliderProps.onPointerDown());
    act(() => result.current.sliderProps.onChange(change(40)));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(onCommit).not.toHaveBeenCalled();
    act(() => result.current.sliderProps.onPointerUp());
    expect(onCommit).toHaveBeenCalledWith(40);
  });

  it('pointercancel and lostpointercapture clear the drag so server sync resumes', () => {
    const onCommit = vi.fn();
    const { result, rerender } = renderHook(({ v }) => useDeferredSlider(v, onCommit), { initialProps: { v: 10 } });
    act(() => result.current.sliderProps.onPointerDown());
    act(() => result.current.sliderProps.onPointerCancel());
    rerender({ v: 55 });
    expect(result.current.value).toBe(55);
    act(() => result.current.sliderProps.onPointerDown());
    act(() => result.current.sliderProps.onLostPointerCapture());
    rerender({ v: 60 });
    expect(result.current.value).toBe(60);
  });
});
