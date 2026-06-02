"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { signIn, signUp, getSession } from "@/lib/db";
import { Layers, Mail, Lock, Building, ArrowRight, CheckCircle2, AlertCircle } from "lucide-react";

export default function LoginPage() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const router = useRouter();

  // Redirect if already logged in
  useEffect(() => {
    getSession().then((session) => {
      if (session) {
        router.replace("/projects");
      }
    });
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      if (isSignUp) {
        await signUp(email, password, companyName.trim());
        setSuccess("Organization provisioned successfully! Check email for confirmation or sign in.");
        setIsSignUp(false);
        setPassword("");
      } else {
        await signIn(email, password);
        router.replace("/projects");
      }
    } catch (err) {
      console.error("Authentication action failed:", err);
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(errorMsg || "Authentication failed. Verify credentials.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 text-foreground font-sans relative overflow-hidden p-4">
      {/* Background Gradient Blurs */}
      <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-blue-600/10 rounded-full blur-[100px] pointer-events-none animate-pulse"></div>
      <div className="absolute bottom-1/4 right-1/4 translate-x-1/2 translate-y-1/2 w-96 h-96 bg-indigo-600/10 rounded-full blur-[100px] pointer-events-none animate-pulse" style={{ animationDelay: "2s" }}></div>

      {/* Main Glassmorphic Container */}
      <div className="w-full max-w-md bg-slate-900/60 backdrop-blur-xl border border-slate-800/80 rounded-2xl shadow-2xl p-8 relative z-10 transition-all duration-300 hover:border-slate-700/60">
        
        {/* Brand/Header */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="p-3 bg-gradient-to-tr from-blue-600 to-indigo-600 rounded-xl shadow-lg shadow-blue-500/20 mb-4 animate-pulse">
            <Layers className="text-white" size={28} />
          </div>
          <h2 className="text-2xl font-extrabold tracking-tight text-white uppercase bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
            Takeoff Bridge
          </h2>
          <p className="text-[10px] text-slate-400 uppercase tracking-widest font-semibold mt-1">
            {isSignUp ? "Initialize Tenant Node" : "Secure Authentication Gate"}
          </p>
        </div>

        {/* Notices (Errors/Success) */}
        {error && (
          <div className="flex items-start gap-2.5 bg-rose-500/10 border border-rose-500/20 text-rose-400 p-3 rounded-lg text-xs mb-6">
            <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="flex items-start gap-2.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 p-3 rounded-lg text-xs mb-6">
            <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0" />
            <span>{success}</span>
          </div>
        )}

        {/* Credentials Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {isSignUp && (
            <div className="space-y-1.5">
              <label className="block text-[10px] uppercase tracking-wider text-slate-400 font-bold">
                Company / Organization Name
              </label>
              <div className="relative">
                <Building className="absolute left-3 top-2.5 text-slate-500" size={14} />
                <input
                  type="text"
                  required
                  placeholder="e.g. Acme Cost Estimating"
                  className="w-full bg-slate-950/40 border border-slate-800 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 rounded-lg pl-9 pr-3 py-2.5 text-xs text-slate-200 outline-none transition-all placeholder:text-slate-600"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="block text-[10px] uppercase tracking-wider text-slate-400 font-bold">
              Corporate Email Address
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-2.5 text-slate-500" size={14} />
              <input
                type="email"
                required
                placeholder="you@company.com"
                className="w-full bg-slate-950/40 border border-slate-800 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 rounded-lg pl-9 pr-3 py-2.5 text-xs text-slate-200 outline-none transition-all placeholder:text-slate-600"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-[10px] uppercase tracking-wider text-slate-400 font-bold">
              Access Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-2.5 text-slate-500" size={14} />
              <input
                type="password"
                required
                placeholder="••••••••••••"
                className="w-full bg-slate-950/40 border border-slate-800 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 rounded-lg pl-9 pr-3 py-2.5 text-xs text-slate-200 outline-none transition-all placeholder:text-slate-600"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          {/* Action Trigger */}
          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold uppercase tracking-wider py-3 rounded-lg flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-blue-900/20 transition-all duration-300 hover:shadow-blue-500/20 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
          >
            {loading ? (
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
            ) : (
              <>
                {isSignUp ? "Initialize Node" : "Access Terminal"}
                <ArrowRight size={14} />
              </>
            )}
          </button>
        </form>

        {/* Auth State Switcher */}
        <div className="text-center mt-6 pt-6 border-t border-slate-800/80">
          <button
            onClick={() => {
              setIsSignUp(!isSignUp);
              setError(null);
              setSuccess(null);
            }}
            className="text-[10px] font-bold text-slate-400 hover:text-blue-400 uppercase tracking-widest transition-colors cursor-pointer"
          >
            {isSignUp
              ? "Already Registered? Sign In"
              : "Register New Corporate Tenant"}
          </button>
        </div>

      </div>
    </div>
  );
}
