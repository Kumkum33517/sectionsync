import "./global.css";

import { Toaster } from "@/components/ui/toaster";
import { createRoot } from "react-dom/client";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

// Handle magic link redirect — Supabase puts the session in the URL hash
// when the user clicks the sign-in link in their email.
function AuthHandler() {
  useEffect(() => {
    // Supabase automatically picks up the hash and sets the session.
    // We just need to clean up the URL after.
    supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") {
        // Remove the hash from the URL so it looks clean
        if (window.location.hash) {
          window.history.replaceState(null, "", window.location.pathname);
        }
      }
    });
  }, []);
  return null;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthHandler />
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

createRoot(document.getElementById("root")!).render(<App />);
