import typer
from scrapy.crawler import CrawlerProcess
from scrapy.utils.project import get_project_settings
import os

from app.crawler.spiders.authorities_spider import AuthoritiesSpider
from app.ingestion.pdf_parser import parse_pdf
from app.ingestion.semantic_chunker import semantic_chunk
from app.ai.embeddings import create_embeddings
from app.ai.vector_store import VectorStoreClient

app = typer.Typer()

@app.command()
def crawl():
    """Runs the Scrapy spider to find and download PDFs."""
    # Note: For a full implementation, the spider would need to be integrated
    # with a downloader and a database to track processed URLs.
    # This is a simplified entry point.
    print("Starting crawler...")
    settings_file_path = 'app.crawler.settings' 
    os.environ.setdefault('SCRAPY_SETTINGS_MODULE', settings_file_path)
    process = CrawlerProcess(get_project_settings())
    process.crawl(AuthoritiesSpider)
    process.start()
    print("Crawler finished.")

@app.command()
def process_file(filepath: str, document_id: str, source_url: str):
    """
    Processes a single PDF file: parses, chunks, embeds, and stores it.
    """
    print(f"Processing file: {filepath}")
    
    # 1. Parse PDF
    text = parse_pdf(filepath)
    if not text:
        print("Could not extract text from PDF.")
        return

    # 2. Semantic Chunking
    chunks = semantic_chunk(text)
    print(f"Created {len(chunks)} semantic chunks.")

    # 3. Create Embeddings
    embeddings = create_embeddings(chunks)
    print(f"Generated {len(embeddings)} embeddings.")

    # 4. Store in Vector DB
    vector_store = VectorStoreClient()
    documents_to_store = [
        {"document_id": document_id, "source_url": source_url, "content": chunk, "chunk_index": i}
        for i, chunk in enumerate(chunks)
    ]
    vector_store.add_documents(documents_to_store, embeddings)
    print("Successfully stored document chunks and embeddings in vector store.")


if __name__ == "__main__":
    app()