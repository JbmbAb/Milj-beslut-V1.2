import pandas as pd
import os
from datetime import datetime
from openpyxl.styles import PatternFill, Font
from openpyxl.formatting.rule import FormulaRule
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table, TableStyleInfo
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.chart import BarChart, Reference

# SÃ¶kvÃ¤gar baserade pÃ¥ docs/qa/requirements-model-workflow.md
BASE_DIR = os.path.join(os.path.dirname(__file__), '..')
INPUT_DIR = os.path.join(BASE_DIR, 'docs', 'qa', 'requirements-model')
OUTPUT_FILE = os.path.join(BASE_DIR, f'Examensmatris_SammanstÃ¤llning_{datetime.now().strftime("%Y-%m-%d")}.xlsx')

NOTEBOOKLM_MAX_CHARS = 900

def read_requirements_csv(path):
    """
    requirements-model exporterar semikolonseparerade CSV-filer.
    LÃ¤ser med fast delimiter fÃ¶r att undvika pandas-standard (komma) tokenizing-fel.
    """
    return pd.read_csv(path, sep=';', encoding='utf-8')

def normalize_text(value):
    """Normalize values for text export and remove placeholder NaN strings."""
    if pd.isna(value):
        return ""
    text = " ".join(str(value).split()).strip()
    if text.lower() == "nan":
        return ""
    return text

def truncate_text(text, max_chars=NOTEBOOKLM_MAX_CHARS):
    """Truncate long text for better NotebookLM readability."""
    if len(text) <= max_chars:
        return text, False
    return text[: max_chars - 3].rstrip() + "...", True
def generate_excel():
    print("LÃ¤ser in CSV-filer frÃ¥n requirements-model...")
    
    try:
        # LÃ¤s in Cases (Metadata om Ã¤rendet)
        cases_df = read_requirements_csv(os.path.join(INPUT_DIR, 'requirement_cases.csv'))
        
        # LÃ¤s in Rows (Specifika kravrader)
        rows_df = read_requirements_csv(os.path.join(INPUT_DIR, 'requirement_rows.csv'))
        
        # SlÃ¥ ihop tabellerna pÃ¥ CaseId fÃ¶r att fÃ¥ en komplett "Master Matris"
        # Detta gÃ¶r att varje kravrad nu har information om Kommun, Ã…rtal, Myndighet etc.
        master_df = pd.merge(rows_df, cases_df, on='CaseId', how='left')

        # SÃ¤kerstÃ¤ll att kolumn fÃ¶r manuell verifiering finns
        if 'VerifieradAv' not in master_df.columns:
            master_df['VerifieradAv'] = ''
        master_df['VerifieradAv'] = master_df['VerifieradAv'].fillna('')

        # Skapa aktiva PDF-lÃ¤nkar om KallaFil finns
        if 'KallaFil' in master_df.columns:
            def create_hyperlink(path):
                if pd.isna(path) or str(path).strip() == "":
                    return ""
                # Skapa absolut sÃ¶kvÃ¤g fÃ¶r att lÃ¤nken ska fungera oavsett var Excel-filen sparas
                full_path = path if os.path.isabs(str(path)) else os.path.abspath(os.path.join(BASE_DIR, str(path)))
                # Excel HYPERLINK-formel
                return f'=HYPERLINK("{full_path}", "Ã–ppna PDF")'
            
            master_df['PDF_LÃ¤nk'] = master_df['KallaFil'].apply(create_hyperlink)
        
        print(f"Skapar Excel-fil: {OUTPUT_FILE}")
        
        with pd.ExcelWriter(OUTPUT_FILE, engine='openpyxl') as writer:
            # 0. SammanstÃ¤llning (Dashboard)
            summary_rows = [
                {'Nyckeltal': 'Rapportdatum', 'VÃ¤rde': datetime.now().strftime("%Y-%m-%d %H:%M")},
                {'Nyckeltal': 'Totalt antal kravrader', 'VÃ¤rde': len(master_df)},
            ]
            if 'Kommun' in master_df.columns:
                summary_rows.append({'Nyckeltal': 'Antal unika kommuner', 'VÃ¤rde': master_df['Kommun'].nunique()})
            
            if 'VerifieradAv' in master_df.columns:
                 verified_count = master_df[master_df['VerifieradAv'] != ''].shape[0]
                 summary_rows.append({'Nyckeltal': 'Antal manuellt verifierade', 'VÃ¤rde': f"{verified_count} ({int(verified_count/len(master_df)*100)}%)"})

            pd.DataFrame(summary_rows).to_excel(writer, sheet_name='SammanstÃ¤llning', index=False)

            # 1. Master Data (KÃ¤llan fÃ¶r dina Pivottabeller)
            master_df.to_excel(writer, sheet_name='Master_Data', index=False)
            
            # 2. Table A: Ã„renden per myndighet (Exempel pÃ¥ sammanstÃ¤llning)
            if 'Myndighet' in master_df.columns:
                table_a = master_df.groupby('Myndighet').size().reset_index(name='Antal Krav')
                table_a.to_excel(writer, sheet_name='Table_A_Myndighet', index=False)

            # 3. Table B: Kravfrekvens per kategori
            if 'Kravkategori' in master_df.columns:
                table_b = master_df['Kravkategori'].value_counts().reset_index()
                table_b.columns = ['Kategori', 'Frekvens']
                table_b.to_excel(writer, sheet_name='Table_B_Kategorier', index=False)
                
                # --- CHART (Graf) ---
                workbook = writer.book
                worksheet = writer.sheets['Table_B_Kategorier']
                
                chart = BarChart()
                chart.type = "col"
                chart.style = 10
                chart.title = "FÃ¶rdelning av Kravkategorier"
                chart.y_axis.title = 'Antal'
                chart.x_axis.title = 'Kategori'

                data = Reference(worksheet, min_col=2, min_row=1, max_row=len(table_b)+1, max_col=2)
                cats = Reference(worksheet, min_col=1, min_row=2, max_row=len(table_b)+1)
                chart.add_data(data, titles_from_data=True)
                chart.set_categories(cats)
                worksheet.add_chart(chart, "D2")

            # --- FORMATERING AV SAMMANSTÃ„LLNING ---
            ws_summary = writer.sheets['SammanstÃ¤llning']
            ws_summary.column_dimensions['A'].width = 35
            ws_summary.column_dimensions['B'].width = 25
            for cell in ws_summary["1:1"]:
                cell.font = Font(bold=True, size=12)

            # 4. Table C: Kommunskillnader (Ytkonstruktion vs Lakvatten)
            if 'Kravkategori' in master_df.columns and 'Kommun' in master_df.columns:
                # Filtrera fram relevanta kategorier
                relevant_cats = ['Ytkonstruktion', 'DagvattenLakvatten']
                table_c = master_df[master_df['Kravkategori'].isin(relevant_cats)]
                # Pivotera fÃ¶r att se fÃ¶rdelning per kommun
                table_c_pivot = pd.crosstab(table_c['Kommun'], table_c['Kravkategori'])
                table_c_pivot.to_excel(writer, sheet_name='Table_C_Kommun_Jmf')

            # 5. Table D: Avfallskoder (EWC)
            # Antar att det finns en kolumn fÃ¶r EWC eller Avfallstyp, annars hoppar vi Ã¶ver
            if 'Avfallskod' in master_df.columns:
                table_d = master_df['Avfallskod'].value_counts().reset_index(name='Antal')
                table_d.to_excel(writer, sheet_name='Table_D_EWC', index=False)

            # --- FORMATERING AV MASTER DATA ---
            workbook = writer.book
            worksheet = writer.sheets['Master_Data']
            
            # HÃ¤mta dimensioner
            max_row = len(master_df) + 1
            max_col = len(master_df.columns)
            max_col_letter = get_column_letter(max_col)
            full_range = f"A1:{max_col_letter}{max_row}"

            # 1. SKAPA EN RIKTIG EXCEL-TABELL (GÃ¶r det enkelt att filtrera/sortera)
            # Detta gÃ¶r att du kan klicka "Infoga Pivottabell" i Excel och den vÃ¤ljer allt automatiskt.
            tab = Table(displayName="KravData", ref=full_range)
            style = TableStyleInfo(name="TableStyleMedium2", showFirstColumn=False,
                                   showLastColumn=False, showRowStripes=True, showColumnStripes=False)
            tab.tableStyleInfo = style
            worksheet.add_table(tab)

            # Hitta vilken kolumn (bokstav) som Ã¤r 'VerifieradAv'
            if 'VerifieradAv' in master_df.columns:
                col_idx = master_df.columns.get_loc('VerifieradAv') + 1
                col_letter = get_column_letter(col_idx)
                
                # 2. VILLKORLIG FORMATERING (GrÃ¶nmarkera verifierade rader)
                green_fill = PatternFill(start_color='C6EFCE', end_color='C6EFCE', fill_type='solid')
                range_string = f"A2:{max_col_letter}{max_row}"
                rule = FormulaRule(formula=[f'${col_letter}2<>""'], stopIfTrue=True, fill=green_fill)
                worksheet.conditional_formatting.add(range_string, rule)

                # 3. DATA VALIDATION (Dropdown-lista fÃ¶r verifiering)
                # Skapa en dropdown i 'VerifieradAv'-kolumnen
                dv = DataValidation(type="list", formula1='"OK,Jimmy,Admin,Ej Relevant"', allow_blank=True)
                dv.error = 'VÃ¤lj ett vÃ¤rde frÃ¥n listan'
                dv.errorTitle = 'Ogiltigt val'
                dv.prompt = 'VÃ¤lj vem som verifierat raden'
                dv.promptTitle = 'Verifiering'
                
                # Applicera pÃ¥ hela kolumnen (exklusive rubrik)
                dv.add(f"{col_letter}2:{col_letter}{max_row}")
                worksheet.add_data_validation(dv)

            # Justera kolumnbredder lite (enkel heuristik)
            for i, column in enumerate(master_df.columns):
                # Hantera NaN/icke-strÃ¤ngvÃ¤rden robust vid lÃ¤ngdberÃ¤kning
                value_max_len = master_df[column].map(lambda value: len(str(value)) if pd.notna(value) else 0).max()
                column_len = max(value_max_len, len(str(column))) + 2
                # SÃ¤tt en maxbredd sÃ¥ inte beskrivningstexter tar Ã¶ver hela skÃ¤rmen
                if column_len > 50: column_len = 50
                worksheet.column_dimensions[get_column_letter(i+1)].width = column_len

        print("Klart! Excel-filen Ã¤r skapad.")
        print("Datan Ã¤r nu formaterad som en Excel-tabell ('KravData').")
        print("FÃ¶r att skapa en Pivottabell: Klicka var som helst i tabellen -> Infoga -> Pivottabell.")

        # --- GENERERA AI-PROMPT UNDERLAG ---
        print("\n" + "="*50)
        print("  DATA-SAMMANFATTNING FÃ–R AI-PROMPT  ")
        print("="*50)
        print(f"Totalt antal analyserade krav: {len(master_df)}")
        if 'Kravkategori' in master_df.columns:
            print("\nTopp 5 Kravkategorier (anvÃ¤nd i Resultat-kapitlet):")
            cats = master_df['Kravkategori'].value_counts(normalize=True) * 100
            for cat, pct in cats.head(5).items():
                print(f"- {cat}: {pct:.1f}%")
        
        if 'Kravniva' in master_df.columns:
            print("\nFÃ¶rdelning SKA vs BÃ–R krav:")
            levels = master_df['Kravniva'].value_counts(normalize=True) * 100
            for lvl, pct in levels.items():
                print(f"- {lvl}: {pct:.1f}%")
        print("="*50 + "\n")

        # --- GENERERA TEXTFIL FÃ–R NOTEBOOKLM ---
        txt_output = os.path.join(BASE_DIR, f'Examensunderlag_NotebookLM_{datetime.now().strftime("%Y-%m-%d")}.txt')
        print(f"Skapar textunderlag optimerat fÃ¶r NotebookLM: {txt_output}")
        
        exported_rows = 0
        truncated_rows = 0
        with open(txt_output, 'w', encoding='utf-8') as f:
            f.write("# SAMMANSTÃ„LLNING AV MYNDIGHETSKRAV (KÃ„LLDATA)\n")
            f.write(f"Genererad: {datetime.now().strftime('%Y-%m-%d')}\n")
            f.write("Detta dokument innehÃ¥ller alla extraherade kravtexter sorterade per kategori.\n")
            f.write("AnvÃ¤nd detta fÃ¶r att frÃ¥ga NotebookLM om kvalitativa mÃ¶nster.\n\n")
            
            if 'Kravkategori' in master_df.columns:
                # Sortera per kategori fÃ¶r tydlighet
                for cat, group in master_df.groupby('Kravkategori'):
                    f.write(f"## KATEGORI: {str(cat).upper()}\n")
                    f.write(f"Antal krav i denna kategori: {len(group)}\n\n")
                    
                    for idx, row in group.iterrows():
                        kommun = normalize_text(row.get('Kommun', 'OkÃ¤nd')) or 'OkÃ¤nd'
                        typ = normalize_text(row.get('KravkallaTyp', 'Krav')) or 'Krav'
                        text = normalize_text(row.get('KravtextCitat', ''))

                        if text:
                            text, was_truncated = truncate_text(text)
                            truncated_tag = " [TRUNCATED]" if was_truncated else ""
                            f.write(f"* **{kommun}** ({typ}){truncated_tag}: \"{text}\"\n")
                            exported_rows += 1
                            if was_truncated:
                                truncated_rows += 1
                    f.write("\n" + "-"*40 + "\n\n")

            f.write("## EXPORTINFO\n")
            f.write(f"- Max tecken per kravtext: {NOTEBOOKLM_MAX_CHARS}\n")
            f.write(f"- Exporterade kravrader: {exported_rows}\n")
            f.write(f"- Trunkerade kravrader: {truncated_rows}\n")

        print(f"NotebookLM-export klar. Exporterade rader: {exported_rows}, trunkerade: {truncated_rows}.")
    except FileNotFoundError as e:
        print(f"Fel: Kunde inte hitta filen. Har du kÃ¶rt 'npm run requirements:model'?\nDetaljer: {e}")
    except Exception as e:
        print(f"Ett ovÃ¤ntat fel uppstod: {e}")

if __name__ == "__main__":
    generate_excel()

