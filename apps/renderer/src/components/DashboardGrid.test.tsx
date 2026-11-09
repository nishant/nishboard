import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WidgetBoundary } from './ErrorState';

// Testing the boundary placed around each widget body (a full DashboardGrid
// render needs react-grid-layout measurements, which jsdom does not provide).
function Boom(): never {
  throw new Error('bad payload');
}

function wrap(ui: React.ReactNode) {
  return <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>;
}

afterEach(cleanup);

describe('WidgetBoundary', () => {
  it('contains one widget crash: siblings and the chrome around it still render, Retry is offered', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      wrap(
        <div>
          <header>titlebar</header>
          <WidgetBoundary id="weather">
            <Boom />
          </WidgetBoundary>
          <WidgetBoundary id="stocks">
            <p>stocks ok</p>
          </WidgetBoundary>
        </div>,
      ),
    );
    expect(screen.getByText('titlebar')).toBeTruthy();
    expect(screen.getByText('stocks ok')).toBeTruthy();
    expect(screen.getByText('This widget crashed')).toBeTruthy();
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
    expect(spy.mock.calls.some((c) => String(c[0]).includes('[widget:weather]'))).toBe(true);
    spy.mockRestore();
  });

  it('Retry re-renders the widget once it stops throwing', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let fail = true;
    function Flaky() {
      if (fail) throw new Error('once');
      return <p>recovered</p>;
    }
    render(
      wrap(
        <WidgetBoundary id="news">
          <Flaky />
        </WidgetBoundary>,
      ),
    );
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(screen.getByText('recovered')).toBeTruthy();
    spy.mockRestore();
  });
});
