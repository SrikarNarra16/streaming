import { notFound } from "next/navigation";
import { TraceDevPanel } from "./panel";

// A development-only page to try POST /api/trace by hand. It is not part of the app: in production it is a 404.
export const dynamic = "force-dynamic";

export default function TraceDevPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <TraceDevPanel />;
}
