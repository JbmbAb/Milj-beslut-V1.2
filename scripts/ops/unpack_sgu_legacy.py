import os
import zipfile
import pathlib
import shutil

SOURCE_DIR = r'H:\Delade enheter\Miljöbeslut\GEO_Master_Archive\Data\SGU\Legacy_Archive\2026-06-10\raw'
TARGET_DIR = r'H:\Delade enheter\Miljöbeslut\GEO_Master_Archive\Data\SGU'

def extract_all():
    source_path = pathlib.Path(SOURCE_DIR)
    target_root = pathlib.Path(TARGET_DIR)
    
    for zip_file in source_path.glob('*.zip'):
        dataset_name = zip_file.stem
        # Clean name if needed (e.g. remove spaces or " (1)")
        clean_name = dataset_name.split(' (')[0].replace(' ', '_')
        
        extract_to = target_root / clean_name / 'extracted'
        print(f'📦 Extracting {zip_file.name} to {extract_to}...')
        
        if not extract_to.exists():
            extract_to.mkdir(parents=True, exist_ok=True)
            
        try:
            with zipfile.ZipFile(zip_file, 'r') as zip_ref:
                zip_ref.extractall(extract_to)
            print(f'   ✅ Done.')
        except Exception as e:
            print(f'   ❌ Failed: {e}')

if __name__ == '__main__':
    extract_all()
