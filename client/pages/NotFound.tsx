import { ArrowLeft } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f6ef] px-6 text-[#0b1825]">
      <div className="max-w-md text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0b1825] text-[#d8ff5b]">404</div>
        <h1 className="mt-7 font-display text-4xl font-bold tracking-[-.06em]">This section is unavailable.</h1>
        <p className="mt-3 text-[#71818a]">The page you’re looking for hasn’t been set up yet.</p>
        <Link to="/" className="mt-7 inline-flex items-center gap-2 rounded-full bg-[#0b1825] px-5 py-3 text-sm font-bold text-white transition-transform hover:-translate-y-0.5">
          <ArrowLeft size={15} /> Back to SectionSync
        </Link>
      </div>
    </main>
  );
};

export default NotFound;
