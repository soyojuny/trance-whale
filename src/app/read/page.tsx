import ReaderNavigation from "@/components/reader/reader-navigation.client";

type ReadPageProps = {
  searchParams: Promise<{ url?: string | string[] }>;
};

export default async function ReadPage({ searchParams }: ReadPageProps) {
  const { url } = await searchParams;
  const initialUrl = typeof url === "string" ? url : "";
  return <ReaderNavigation initialUrl={initialUrl} />;
}
