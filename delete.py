#!/usr/bin/env python3
"""
Next.js App Directory Explorer - A tool to recursively explore the app/(student) directory 
in a Next.js project and save file paths and contents to a text file.
"""

import os
import argparse
from pathlib import Path
import mimetypes
import sys
from datetime import datetime

def is_binary(file_path):
    """
    Check if a file is binary based on its mime type or content.
    """
    # Check mime type first
    mime_type, _ = mimetypes.guess_type(file_path)
    if mime_type and not mime_type.startswith(('text/', 'application/json', 'application/xml')):
        return True
    
    # If mime type check is inconclusive, look at file content
    try:
        with open(file_path, 'rb') as file:
            chunk = file.read(1024)
            return b'\0' in chunk  # Binary files often contain null bytes
    except Exception:
        return True  # If we can't read the file, assume it's binary

def explore_directories(directory, output_file, ignore_dirs=None, ignore_extensions=None, max_file_size=1024*1024):
    """
    Recursively explore a directory and save content to a text file.
    Args:
        directory (str): The starting directory path
        output_file (str): Path to the output text file
        ignore_dirs (list): Directories to ignore
        ignore_extensions (list): File extensions to ignore
        max_file_size (int): Maximum file size in bytes to display content (default 1MB)
    """
    if ignore_dirs is None:
        ignore_dirs = ['.git', 'node_modules', '.next', 'venv', '__pycache__', '.idea', '.vscode', 'public', 'out', 'build']
    if ignore_extensions is None:
        ignore_extensions = ['.pyc', '.class', '.o', '.so', '.dll', '.exe', 
                             '.jpg', '.jpeg', '.png', '.gif', '.svg', '.ico', 
                             '.pdf', '.zip', '.tar.gz', '.rar']
    # Convert to absolute path
    directory = os.path.abspath(directory)
    if not os.path.exists(directory):
        print(f"Error: Could not find directory {directory}")
        return
    print(f"Exploring directory: {directory}")
    # Open output file in append mode
    with open(output_file, 'a', encoding='utf-8') as out_file:
        out_file.write(f"{'#'*100}\n")
        out_file.write(f"EXPLORING DIRECTORY: {os.path.basename(directory)}\n")
        out_file.write(f"Path: {directory}\n")
        out_file.write(f"{'#'*100}\n\n")
        # Get all files recursively in the target directory
        for root, dirs, files in os.walk(directory):
            # Skip directories in ignore_dirs
            dirs[:] = [d for d in dirs if d not in ignore_dirs]
            for file in files:
                file_path = os.path.join(root, file)
                rel_path = os.path.relpath(file_path, directory)
                # Skip files with ignored extensions
                if any(file.endswith(ext) for ext in ignore_extensions):
                    continue
                # Get file size
                try:
                    file_size = os.path.getsize(file_path)
                except OSError:
                    continue  # Skip files that can't be accessed
                # Write file path
                out_file.write(f"\n{'='*80}\nFILE: {rel_path}\n{'='*80}\n")
                # Check if file is too large
                if file_size > max_file_size:
                    out_file.write(f"[File too large to display: {file_size/1024/1024:.2f} MB]\n")
                    continue
                # Check if file is binary
                if is_binary(file_path):
                    out_file.write("[Binary file - content not displayed]\n")
                    continue
                # Display file content
                try:
                    with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
                        content = f.read()
                        out_file.write(content + "\n")
                except Exception as e:
                    out_file.write(f"[Error reading file: {e}]\n")

def main():
    parser = argparse.ArgumentParser(description='Explore app/(student) directory and save content to a text file.')
    parser.add_argument('--path', '-p', default='.', help='Path to Next.js project (default: current directory)')
    parser.add_argument('--output', '-o', default='app_directory_content.txt', help='Output file path')
    parser.add_argument('--ignore-dirs', '-d', nargs='+', help='Additional directories to ignore')
    parser.add_argument('--ignore-exts', '-e', nargs='+', help='Additional file extensions to ignore')
    parser.add_argument('--max-size', '-m', type=int, default=1024*1024, 
                        help='Maximum file size in bytes to display (default: 1MB)')
    
    args = parser.parse_args()
    
    if not os.path.isdir(args.path):
        print(f"Error: '{args.path}' is not a valid directory")
        return
    
    # Combine default and user-provided ignore dirs
    ignore_dirs = ['.git', 'node_modules', '.next', 'venv', '__pycache__', '.idea', '.vscode', 'public', 'out', 'build']
    if args.ignore_dirs:
        ignore_dirs.extend(args.ignore_dirs)
    # Combine default and user-provided ignore extensions
    ignore_exts = ['.pyc', '.class', '.o', '.so', '.dll', '.exe', 
                  '.jpg', '.jpeg', '.png', '.gif', '.svg', '.ico', 
                  '.pdf', '.zip', '.tar.gz', '.rar']
    if args.ignore_exts:
        ignore_exts.extend(args.ignore_exts)
    # Clear output file before writing
    with open(args.output, 'w', encoding='utf-8') as out_file:
        out_file.write(f"Next.js App Directory Explorer\n")
        out_file.write(f"Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        out_file.write(f"Base directory: {args.path}\n")
        out_file.write(f"Explored directories: app, components\n\n")
    # Explore both 'app' and 'components' directories
    for target in ["app", "components"]:
        target_dir = os.path.join(args.path, target)
        explore_directories(target_dir, args.output, ignore_dirs, ignore_exts, args.max_size)
    print(f"Exploration complete. Results saved to {args.output}")

if __name__ == "__main__":
    main()