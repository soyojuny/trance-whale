import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import ReaderPrototype from "../../src/components/reader-prototype";

describe("ReaderPrototype", () => {
  it("offers the core reading journey without requiring a backend", () => {
    render(<ReaderPrototype />);

    expect(screen.getByRole("heading", { name: "읽고 싶은 이야기를 가져오세요" })).toBeInTheDocument();
    expect(screen.getByLabelText("웹소설 장 URL")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "번역해서 읽기" })).toBeInTheDocument();
    expect(screen.getByText("38 / 52 문단")).toBeInTheDocument();
  });

  it("switches reading modes and opens the catalog panel", () => {
    render(<ReaderPrototype />);

    fireEvent.click(screen.getByRole("button", { name: "함께 보기" }));
    expect(screen.getByText("天色渐暗，远处的群山沉入薄雾。" )).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "목차 열기" }));
    expect(screen.getByRole("dialog", { name: "작품 목차" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("장 번호 또는 제목 검색")).toBeInTheDocument();
  });

  it("lets the user add translation instructions in settings", () => {
    render(<ReaderPrototype />);

    fireEvent.click(screen.getByRole("button", { name: "설정 열기" }));

    expect(screen.getByLabelText("사용자 번역 프롬프트")).toBeInTheDocument();
    expect(screen.getByText("기본 번역 원칙은 항상 함께 적용돼요.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "현재 장 다시 번역" })).toBeInTheDocument();
  });

  it("keeps a prompt draft and requires saving before retranslation", () => {
    render(<ReaderPrototype />);

    fireEvent.click(screen.getByRole("button", { name: "설정 열기" }));
    const prompt = screen.getByLabelText("사용자 번역 프롬프트");
    fireEvent.change(prompt, { target: { value: "주인공은 반말을 사용해 주세요." } });

    expect(screen.getByText("저장되지 않은 변경")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "현재 장 다시 번역" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    fireEvent.click(screen.getByRole("button", { name: "설정 열기" }));
    expect(screen.getByLabelText("사용자 번역 프롬프트")).toHaveValue("주인공은 반말을 사용해 주세요.");

    fireEvent.click(screen.getByRole("button", { name: "변경사항 저장" }));
    expect(screen.getByText("저장됨 · 다음 장부터 적용")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "현재 장 다시 번역" })).toBeEnabled();
  });

  it("requires saving a model change before retranslation", () => {
    render(<ReaderPrototype />);

    fireEvent.click(screen.getByRole("button", { name: "설정 열기" }));
    fireEvent.click(screen.getByRole("radio", { name: /고품질 번역/ }));

    expect(screen.getByText("저장되지 않은 변경")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "현재 장 다시 번역" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "변경사항 저장" }));
    expect(screen.getByText("고품질 번역 설정이 저장됐어요.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "현재 장 다시 번역" })).toBeEnabled();
  });

  it("allows editing and revealing the API key before saving it", () => {
    render(<ReaderPrototype />);

    fireEvent.click(screen.getByRole("button", { name: "설정 열기" }));
    const keyInput = screen.getByLabelText("Gemini API Key");

    expect(keyInput).not.toHaveAttribute("readonly");
    expect(keyInput).toHaveAttribute("type", "password");

    fireEvent.click(screen.getByRole("button", { name: "API Key 표시" }));
    expect(keyInput).toHaveAttribute("type", "text");

    fireEvent.change(keyInput, { target: { value: "new-demo-key" } });
    expect(screen.getByText("저장되지 않은 변경")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "현재 장 다시 번역" })).toBeDisabled();
  });

  it("keeps chapter navigation and reading settings available while reading", () => {
    render(<ReaderPrototype />);

    const toolbar = screen.getByRole("navigation", { name: "모바일 독서 도구" });
    expect(toolbar).toBeInTheDocument();
    expect(toolbar).toHaveTextContent("이전 장");
    expect(toolbar).toHaveTextContent("목차");
    expect(toolbar).toHaveTextContent("읽기 설정");
    expect(toolbar).toHaveTextContent("다음 장");
  });
});
