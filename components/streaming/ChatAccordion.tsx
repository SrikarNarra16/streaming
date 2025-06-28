// components/streaming/ChatAccordion.tsx (PRODUCTION READY)
"use client";

import React, { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";

interface ChatAccordionProps {
  accordionId: string;
  chatMessages: Array<{ role: "user" | "ai"; message: string }>;
  currentChatInput: string;
  setCurrentChatInput: (value: string) => void;
  onSubmit: (accordionId: string) => void;
  isLoadingResponse: boolean;
  isReadOnly?: boolean;
  userFeedback?: "understood" | "did_not_understand";
  onContinue?: () => void;
  isDimmed?: boolean;
  defaultClosed?: boolean; // NEW: Control default state
}

export function ChatAccordion({
  accordionId,
  chatMessages,
  currentChatInput,
  setCurrentChatInput,
  onSubmit,
  isLoadingResponse,
  isReadOnly = false,
  userFeedback,
  onContinue,
  isDimmed = false,
  defaultClosed = false,
}: ChatAccordionProps) {
  // Simple, reliable state management
  const [isExpanded, setIsExpanded] = useState(!defaultClosed);

  // Reset to closed when defaultClosed changes (for new accordions)
  useEffect(() => {
    if (defaultClosed) {
      setIsExpanded(false);
    }
  }, [defaultClosed]);

  const toggleExpanded = () => {
    setIsExpanded(!isExpanded);
  };

  if (isReadOnly) {
    const isUnderstood = userFeedback === "understood";
    
    // Modern color scheme
    const bgColor = isUnderstood 
      ? "bg-gradient-to-r from-teal-900/20 to-blue-900/20" 
      : "bg-gradient-to-r from-indigo-900/20 to-purple-900/20";
    const hoverBgColor = isUnderstood 
      ? "hover:from-teal-800/30 hover:to-blue-800/30" 
      : "hover:from-indigo-800/30 hover:to-purple-800/30";
    const borderColor = isUnderstood 
      ? "border-teal-600/30" 
      : "border-indigo-600/30";
    const iconColor = isUnderstood 
      ? "bg-teal-500" 
      : "bg-indigo-500";
    const textColor = isUnderstood 
      ? "text-teal-300" 
      : "text-indigo-300";
    const icon = isUnderstood ? "✓" : "💬";
    const feedbackText = isUnderstood 
      ? "I understand" 
      : "I needed clarification";

    // Apply dimming if specified
    const dimClass = isDimmed ? "opacity-70" : "";

    return (
      <div className={`border ${borderColor} rounded-lg overflow-hidden ${bgColor} ${dimClass} transition-all duration-200`}>
        {/* Header - Always clickable if there are chat messages */}
        <button 
          onClick={chatMessages.length > 0 ? toggleExpanded : undefined}
          className={`w-full px-4 py-3 text-left transition-all duration-200 ${
            chatMessages.length > 0 ? `${hoverBgColor} cursor-pointer` : 'cursor-default'
          }`}
          disabled={chatMessages.length === 0}
        >
          <div className="flex items-center gap-3">
            <div className={`w-5 h-5 flex-shrink-0 rounded-full flex items-center justify-center text-xs font-bold text-white ${iconColor}`}>
              {icon}
            </div>
            <span className={`font-medium ${textColor}`}>
              Your Response: {feedbackText}
            </span>
            {chatMessages.length > 0 && (
              <div className="ml-auto text-slate-400 text-sm flex items-center gap-2">
                <span>{isExpanded ? "Hide" : "Show"} Chat History</span>
                <svg 
                  className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? 'rotate-180' : 'rotate-0'}`}
                  fill="none" 
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            )}
          </div>
        </button>
        
        {/* Collapsible Content */}
        <div 
          className={`transition-all duration-300 ease-in-out overflow-hidden ${
            isExpanded && chatMessages.length > 0 
              ? 'max-h-96 opacity-100' 
              : 'max-h-0 opacity-0'
          }`}
        >
          {chatMessages.length > 0 && (
            <div className="p-4 pt-2 bg-slate-800/30">
              <div className="max-h-40 overflow-y-auto space-y-2 bg-slate-900/50 p-3 rounded">
                {chatMessages.map((msg, index) => (
                  <div key={index} className={`text-sm ${msg.role === "user" ? "text-blue-300" : "text-emerald-300"}`}>
                    <span className="font-semibold">{msg.role === "user" ? "You:" : "AI:"}</span>{" "}
                    <ReactMarkdown components={{ p: ({ children }) => <span className="inline">{children}</span> }}>
                      {msg.message}
                    </ReactMarkdown>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Active (non-readonly) chat accordion
  return (
    <div className="mb-4">
      <div className="border border-slate-600 rounded-lg overflow-hidden bg-gradient-to-r from-indigo-900/20 to-purple-900/20">
        <div className="px-4 py-3 bg-gradient-to-r from-indigo-600/20 to-purple-600/20 border-b border-slate-600">
          <span className="text-indigo-300 font-medium">💬 Ask questions about this explanation</span>
        </div>
        <div className="p-4 space-y-4 bg-slate-800/30">
          <div className="max-h-40 overflow-y-auto space-y-2 bg-slate-900/50 p-3 rounded">
            {chatMessages.length === 0 ? (
              <div className="text-slate-400 text-sm">Ask me anything about this section...</div>
            ) : (
              chatMessages.map((msg, index) => (
                <div key={index} className={`text-sm ${msg.role === "user" ? "text-blue-300" : "text-emerald-300"}`}>
                  <span className="font-semibold">{msg.role === "user" ? "You:" : "AI:"}</span>{" "}
                  <ReactMarkdown components={{ p: ({ children }) => <span className="inline">{children}</span> }}>
                    {msg.message}
                  </ReactMarkdown>
                </div>
              ))
            )}
            {isLoadingResponse && (
              <div className="text-slate-400 text-sm italic">AI is thinking...</div>
            )}
          </div>
          
          <div className="flex space-x-2">
            <input 
              type="text" 
              value={currentChatInput} 
              onChange={(e) => setCurrentChatInput(e.target.value)} 
              onKeyPress={(e) => e.key === "Enter" && !isLoadingResponse && onSubmit(accordionId)} 
              disabled={isLoadingResponse} 
              className="flex-1 px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50" 
              placeholder={isLoadingResponse ? "AI is responding..." : "Type your question..."} 
            />
            <button 
              onClick={() => onSubmit(accordionId)} 
              disabled={isLoadingResponse || !currentChatInput.trim()} 
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Send
            </button>
          </div>
          
          <div className="flex justify-end">
            <button 
              onClick={onContinue} 
              className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors"
            >
              Continue with explanation
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
