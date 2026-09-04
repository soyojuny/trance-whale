import { Suspense } from "react";
import ReaderNavigation from "@/components/reader/reader-navigation.client";

export default function ReadPage() {
  return <Suspense fallback={<main className="reader-empty-state" role="status">리더 준비 중</main>}><ReaderNavigation initialUrl="" /></Suspense>;
}
