// components/streaming/ModernAIOutputDisplay.tsx
"use client";

import React from 'react';
import ReactMarkdown from 'react-markdown';

export function ModernAIOutputDisplay({ 
    answer, 
    onContinue,
    buttonText = "Continue Learning",
    loading = false,
    markdownComponents
}: {
    answer: string;
    onContinue: () => void;
    buttonText?: string;
    loading?: boolean;
    markdownComponents: any;
}) {
    return (
        <div className="my-8 p-8 bg-gradient-to-br from-emerald-900/30 to-teal-900/30 border border-emerald-500/40 rounded-2xl backdrop-blur-sm shadow-2xl">
            <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full flex items-center justify-center shadow-lg">
                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                </div>
                <div>
                    <h3 className="text-2xl font-bold text-emerald-300 mb-1">Now let's see the AI output!</h3>
                    <p className="text-emerald-200/80">Here's the complete solution from our AI system</p>
                </div>
            </div>
            
            <div className="bg-slate-900/50 rounded-xl p-6 mb-6 border border-slate-700/50">
                <div className="flex items-center gap-2 mb-4">
                    <div className="w-3 h-3 bg-emerald-500 rounded-full animate-pulse"></div>
                    <span className="text-sm font-medium text-emerald-400">AI Generated Answer</span>
                </div>
                <div className="text-white text-lg leading-relaxed whitespace-pre-line min-h-[48px]">
                    <ReactMarkdown components={markdownComponents}>
                        {answer}
                    </ReactMarkdown>
                    {loading && (
                        <span className="ml-2 animate-pulse text-emerald-400">|</span>
                    )}
                </div>
            </div>
            
            <div className="flex justify-center">
                <button
                    onClick={onContinue}
                    disabled={loading}
                    className={`px-8 py-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold rounded-xl transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105 flex items-center gap-3 ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                    <span>{buttonText}</span>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                </button>
            </div>
        </div>
    );
}