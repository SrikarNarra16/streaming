"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import { ChatAccordion } from "./ChatAccordion";

interface ParagraphAccordion {
  id: string;
  position: number;
  chatMessages: Array<{ role: "user" | "ai"; message: string }>;
  paragraphContext: string;
}

interface TextRendererProps {
  text: string;
  paragraphAccordions: ParagraphAccordion[];
  currentAccordionId: string | null;
}

export function TextRenderer({
  text,
  paragraphAccordions,
  currentAccordionId,
}: TextRendererProps) {
  const markdownComponents = {
    p: ({ children }) => (
      <div className="mb-4 leading-relaxed">{children}</div>
    ),
    code: ({ children }) => (
      <code className="bg-gray-700 px-2 py-1 rounded text-yellow-300 font-mono text-sm">
        {children}
      </code>
    ),
    pre: ({ children }) => (
      <pre className="bg-gray-800 p-4 rounded mt-2 mb-4 overflow-x-auto border border-gray-600">
        <code className="text-green-300 font-mono text-sm">{children}</code>
      </pre>
    ),
    ul: ({ children }) => (
      <ul className="list-disc list-inside mb-4 ml-4">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="list-decimal list-inside mb-4 ml-4">{children}</ol>
    ),
    li: ({ children }) => <li className="mb-1">{children}</li>,
    strong: ({ children }) => {
      const text = children?.toString() || "";
      if (text.includes("✓")) {
        return (
          <span className="font-bold text-green-400 bg-green-900/30 px-2 py-1 rounded">
            {children}
          </span>
        );
      } else if (text.includes("✗")) {
        return (
          <span className="font-bold text-red-400 bg-red-900/30 px-2 py-1 rounded">
            {children}
          </span>
        );
      }
      return <strong className="font-bold text-blue-300">{children}</strong>;
    },
    em: ({ children }) => <em className="italic text-gray-300">{children}</em>,
    h1: ({ children }) => (
      <h1 className="text-2xl font-bold mb-4 text-blue-300">{children}</h1>
    ),
    h2: ({ children }) => (
      <h2 className="text-xl font-bold mb-3 text-blue-300">{children}</h2>
    ),
    h3: ({ children }) => (
      <h3 className="text-lg font-bold mb-2 text-blue-300">{children}</h3>
    ),
  };

  if (paragraphAccordions.length === 0) {
    return <ReactMarkdown components={markdownComponents}>{text}</ReactMarkdown>;
  }

  // Filter out the currently active accordion to prevent duplication
  const completedAccordions = paragraphAccordions.filter(
    (accordion) => accordion.id !== currentAccordionId
  );

  if (completedAccordions.length === 0) {
    return <ReactMarkdown components={markdownComponents}>{text}</ReactMarkdown>;
  }

  // Sort accordions by position
  const sortedAccordions = [...completedAccordions].sort(
    (a, b) => a.position - b.position
  );

  let result = [];
  let lastIndex = 0;

  sortedAccordions.forEach((accordion) => {
    // Add text before this accordion
    if (accordion.position > lastIndex) {
      const textChunk = text.slice(lastIndex, accordion.position);
      result.push(
        <ReactMarkdown
          key={`text-${lastIndex}`}
          components={markdownComponents}
        >
          {textChunk}
        </ReactMarkdown>
      );
    }

    // Add the accordion (read-only version)
    result.push(
      <div key={accordion.id} className="my-4">
        <ChatAccordion
          accordionId={accordion.id}
          chatMessages={accordion.chatMessages}
          currentChatInput=""
          setCurrentChatInput={() => {}}
          onSubmit={() => {}}
          isLoadingResponse={false}
          isReadOnly={true}
        />
      </div>
    );

    lastIndex = accordion.position;
  });

  // Add remaining text
  if (lastIndex < text.length) {
    const remainingText = text.slice(lastIndex);
    result.push(
      <ReactMarkdown
        key={`text-${lastIndex}`}
        components={markdownComponents}
      >
        {remainingText}
      </ReactMarkdown>
    );
  }

  return <>{result}</>;
}