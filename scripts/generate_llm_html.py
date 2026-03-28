import os
import re
import webbrowser
from pathlib import Path
from typing import Optional

import openai
# Note: ResponseInputParam might be specific to a certain SDK version or environment
try:
    from openai.types.responses import ResponseInputParam
except ImportError:
    # Fallback if the specific type is not available
    ResponseInputParam = str

client = openai.OpenAI()

def get_response_output_text(prompt_input: str | ResponseInputParam) -> str:
    """Send a prompt to GPT-5 and return the output text."""
    response = client.responses.create(
        model="gpt-5",
        input=prompt_input,
    )
    return getattr(response, "output_text", str(response))

def extract_html_from_text(text: str) -> str:
    """Extract an HTML code block from text; fallback to first code block, else full text."""
    # Look for ```html ... ```
    html_block = re.search(r"```html\s*(.*?)\s*```", text, re.DOTALL | re.IGNORECASE)
    if html_block:
        return html_block.group(1).strip()
    
    # Fallback to any code block ``` ... ```
    any_block = re.search(r"```\s*(.*?)\s*```", text, re.DOTALL)
    if any_block:
        return any_block.group(1).strip()
    
    return text.strip()

def save_html(html: str, filename: str) -> Path:
    """Save HTML to outputs/ directory and return the path."""
    try:
        base_dir = Path(__file__).parent
    except NameError:
        base_dir = Path.cwd()

    # If inside a scripts folder, go up to project root, then to outputs
    if base_dir.name == "scripts":
        outputs_dir = base_dir.parent / "outputs"
    else:
        outputs_dir = base_dir / "outputs"

    outputs_dir.mkdir(parents=True, exist_ok=True)

    output_path = outputs_dir / filename
    output_path.write_text(html, encoding="utf-8")
    return output_path

def open_in_browser(path: Path) -> None:
    """Open a file in the default browser."""
    try:
        # standard library way
        webbrowser.open(path.as_uri())
    except Exception:
        # Fallback for systems where webbrowser fails
        if os.name == 'nt': # Windows
            os.startfile(path)
        else: # macOS / Linux
            os.system(f'open "{path}"')

if __name__ == "__main__":
    # Example usage
    example_prompt = "Create a premium dark mode dashboard for a fleet management system using Tailwind CSS and Lucide icons. Return ONLY the HTML code block."
    
    print(f"Generating HTML using GPT-5 for prompt: '{example_prompt}'...")
    try:
        raw_text = get_response_output_text(example_prompt)
        html_code = extract_html_from_text(raw_text)
        
        file_path = save_html(html_code, "dashboard_preview.html")
        print(f"HTML saved to: {file_path}")
        
        print("Opening in browser...")
        open_in_browser(file_path)
    except Exception as e:
        print(f"Error during implementation: {e}")
