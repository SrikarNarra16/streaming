// components/streaming/ModernBlankInput.tsx
"use client";

import React from 'react';

export function ModernBlankInput({ 
    userInput, 
    setUserInput, 
    onSubmit, 
    feedbackMessage 
}: {
    userInput: string;
    setUserInput: (value: string) => void;
    onSubmit: () => void;
    feedbackMessage: string;
}) {
    return (
        <div className="my-6 p-6 bg-gradient-to-r from-blue-900/20 to-purple-900/20 border border-blue-500/30 rounded-xl backdrop-blur-sm">
            <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
                    <span className="text-white font-bold text-sm">?</span>
                </div>
                <h3 className="text-lg font-semibold text-blue-300">Fill in the blank</h3>
            </div>
            
            <div className="space-y-4">
                <div className="flex gap-3">
                    <input
                        type="text"
                        value={userInput}
                        onChange={(e) => setUserInput(e.target.value)}
                        onKeyPress={(e) => e.key === "Enter" && onSubmit()}
                        placeholder="Type your answer here..."
                        className="flex-1 px-4 py-3 bg-slate-800/50 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
                        autoFocus
                    />
                    <button
                        onClick={onSubmit}
                        disabled={!userInput.trim()}
                        className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:opacity-50 text-white font-medium rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl"
                    >
                        Submit
                    </button>
                </div>
                
                {feedbackMessage && (
                    <div className={`p-3 rounded-lg text-center font-medium ${
                        feedbackMessage.includes("✓") 
                            ? "bg-green-900/30 text-green-300 border border-green-500/30" 
                            : "bg-red-900/30 text-red-300 border border-red-500/30"
                    }`}>
                        {feedbackMessage}
                    </div>
                )}
            </div>
        </div>
    );
}