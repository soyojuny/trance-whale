import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import PwaInstallPrompt from "../../src/components/pwa-install-prompt";

type BeforeInstallPromptEvent = Event & {
  prompt(): Promise<{ outcome: "accepted" | "dismissed" }>;
};

const originalUserAgent = window.navigator.userAgent;

function setUserAgent(userAgent: string) {
  Object.defineProperty(window.navigator, "userAgent", { configurable: true, value: userAgent });
}

afterEach(() => {
  setUserAgent(originalUserAgent);
});

describe("PwaInstallPrompt", () => {
  it("opens the deferred browser install prompt only after the user chooses to install", async () => {
    render(<PwaInstallPrompt />);
    const prompt = vi.fn(async () => ({ outcome: "accepted" as const }));
    const event = new Event("beforeinstallprompt", { cancelable: true }) as BeforeInstallPromptEvent;
    Object.assign(event, { prompt });

    window.dispatchEvent(event);

    const button = await screen.findByRole("button", { name: "앱 설치" });
    expect(event.defaultPrevented).toBe(true);
    expect(prompt).not.toHaveBeenCalled();

    fireEvent.click(button);
    await waitFor(() => expect(prompt).toHaveBeenCalledOnce());
  });

  it("guides iOS Safari users to Add to Home Screen", () => {
    setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1");

    render(<PwaInstallPrompt />);

    expect(screen.getByText("Safari 공유 메뉴에서 홈 화면에 추가를 선택하세요.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "앱 설치" })).not.toBeInTheDocument();
  });

  it("hides the promotion once the app has been installed", async () => {
    render(<PwaInstallPrompt />);
    const event = new Event("beforeinstallprompt", { cancelable: true }) as BeforeInstallPromptEvent;
    Object.assign(event, { prompt: vi.fn(async () => ({ outcome: "accepted" as const })) });
    window.dispatchEvent(event);
    expect(await screen.findByRole("button", { name: "앱 설치" })).toBeInTheDocument();

    window.dispatchEvent(new Event("appinstalled"));

    await waitFor(() => expect(screen.queryByRole("button", { name: "앱 설치" })).not.toBeInTheDocument());
  });
});
