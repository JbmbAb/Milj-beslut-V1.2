Option Explicit

' ============================================================
' Outlook Move Tools
' Syfte:
' - Flytta mejl till en och samma mapp oavsett hur urvalet gjorts
'   A) Markerade mejl i Outlook
'   B) EntryID-lista i CSV (t.ex. filtrerad i Excel)
' ============================================================

Private Const TARGET_FOLDER_NAME As String = "Triage_Samlad"
Private Const DEFAULT_TRIAGE_CSV As String = "C:\Users\jimmy\Desktop\OutlookExport\outlook_email_triage_report.csv"
Private Const CSV_DELIMITER As String = ";"

Public Sub MoveSelectedMailItemsToSingleFolder()
    Dim exp As Outlook.Explorer
    Dim sel As Outlook.Selection
    Dim ns As Outlook.NameSpace
    Dim targetFolder As Outlook.Folder
    Dim i As Long
    Dim itm As Object
    Dim movedCount As Long
    Dim skippedCount As Long

    Set exp = Application.ActiveExplorer
    If exp Is Nothing Then
        MsgBox "Ingen aktiv Outlook-vy hittades.", vbExclamation
        Exit Sub
    End If

    Set sel = exp.Selection
    If sel Is Nothing Or sel.Count = 0 Then
        MsgBox "Markera minst ett mejl och k�r igen.", vbInformation
        Exit Sub
    End If

    Set ns = Application.Session
    Set targetFolder = GetOrCreateTargetFolder(ns, TARGET_FOLDER_NAME)
    If targetFolder Is Nothing Then
        MsgBox "Kunde inte skapa/h�mta m�lmappen.", vbCritical
        Exit Sub
    End If

    movedCount = 0
    skippedCount = 0

    For i = sel.Count To 1 Step -1
        Set itm = sel.Item(i)
        If Not itm Is Nothing Then
            If itm.Class = olMail Then
                On Error Resume Next
                itm.Move targetFolder
                If Err.Number = 0 Then
                    movedCount = movedCount + 1
                Else
                    skippedCount = skippedCount + 1
                End If
                Err.Clear
                On Error GoTo 0
            Else
                skippedCount = skippedCount + 1
            End If
        End If
    Next i

    MsgBox "Klart." & vbCrLf & _
           "Flyttade: " & movedCount & vbCrLf & _
           "Hoppade �ver: " & skippedCount & vbCrLf & _
           "M�lmapp: " & targetFolder.FolderPath, vbInformation
End Sub

Public Sub MoveEntryIdsFromCsvToSingleFolder()
    Dim ns As Outlook.NameSpace
    Dim targetFolder As Outlook.Folder
    Dim csvPath As String
    Dim fso As Object
    Dim ts As Object
    Dim line As String
    Dim header As String
    Dim lineNo As Long
    Dim entryIdCol As Long
    Dim entryId As String
    Dim dict As Object

    Dim movedCount As Long
    Dim missingCount As Long
    Dim skippedCount As Long

    Set ns = Application.Session
    Set targetFolder = GetOrCreateTargetFolder(ns, TARGET_FOLDER_NAME)
    If targetFolder Is Nothing Then
        MsgBox "Kunde inte skapa/h�mta m�lmappen.", vbCritical
        Exit Sub
    End If

    csvPath = DEFAULT_TRIAGE_CSV
    If Not FileExists(csvPath) Then
        csvPath = InputBox("Ange full s�kv�g till CSV med EntryID-kolumn:", "CSV-path", DEFAULT_TRIAGE_CSV)
        If Len(Trim$(csvPath)) = 0 Then Exit Sub
        If Not FileExists(csvPath) Then
            MsgBox "CSV-filen hittades inte: " & csvPath, vbExclamation
            Exit Sub
        End If
    End If

    Set fso = CreateObject("Scripting.FileSystemObject")
    Set ts = fso.OpenTextFile(csvPath, 1)
    If ts.AtEndOfStream Then
        ts.Close
        MsgBox "CSV-filen �r tom.", vbExclamation
        Exit Sub
    End If

    header = ts.ReadLine
    lineNo = 1
    entryIdCol = FindColumnIndex(header, "EntryID", CSV_DELIMITER)
    If entryIdCol <= 0 Then
        ts.Close
        MsgBox "Kunde inte hitta kolumnen 'EntryID' i CSV.", vbExclamation
        Exit Sub
    End If

    Set dict = CreateObject("Scripting.Dictionary")
    dict.CompareMode = 1 ' vbTextCompare

    Do While Not ts.AtEndOfStream
        line = ts.ReadLine
        lineNo = lineNo + 1
        If Len(Trim$(line)) > 0 Then
            entryId = ExtractNthCsvField(line, entryIdCol, CSV_DELIMITER)
            entryId = UnquoteCsvField(entryId)
            If Len(entryId) > 0 Then
                If Not dict.Exists(entryId) Then dict(entryId) = 1
            End If
        End If
    Loop
    ts.Close

    movedCount = 0
    missingCount = 0
    skippedCount = 0

    Dim key As Variant
    Dim itm As Object
    For Each key In dict.Keys
        Set itm = GetItemByEntryIDSafe(ns, CStr(key))
        If itm Is Nothing Then
            missingCount = missingCount + 1
        ElseIf itm.Class <> olMail Then
            skippedCount = skippedCount + 1
        Else
            On Error Resume Next
            itm.Move targetFolder
            If Err.Number = 0 Then
                movedCount = movedCount + 1
            Else
                skippedCount = skippedCount + 1
            End If
            Err.Clear
            On Error GoTo 0
        End If
    Next key

    MsgBox "Klart." & vbCrLf & _
           "CSV: " & csvPath & vbCrLf & _
           "Unika EntryID: " & dict.Count & vbCrLf & _
           "Flyttade: " & movedCount & vbCrLf & _
           "Saknas i Outlook: " & missingCount & vbCrLf & _
           "Hoppade �ver: " & skippedCount & vbCrLf & _
           "M�lmapp: " & targetFolder.FolderPath, vbInformation
End Sub

Private Function GetOrCreateTargetFolder(ByVal ns As Outlook.NameSpace, ByVal folderName As String) As Outlook.Folder
    Dim root As Outlook.Folder
    Dim target As Outlook.Folder

    On Error Resume Next
    Set root = ns.DefaultStore.GetRootFolder
    On Error GoTo 0
    If root Is Nothing Then Exit Function

    On Error Resume Next
    Set target = root.Folders(folderName)
    On Error GoTo 0

    If target Is Nothing Then
        On Error Resume Next
        Set target = root.Folders.Add(folderName)
        On Error GoTo 0
    End If

    Set GetOrCreateTargetFolder = target
End Function

Private Function FileExists(ByVal path As String) As Boolean
    On Error Resume Next
    FileExists = CreateObject("Scripting.FileSystemObject").FileExists(path)
    On Error GoTo 0
End Function

Private Function GetItemByEntryIDSafe(ByVal ns As Outlook.NameSpace, ByVal entryId As String) As Object
    On Error Resume Next
    Set GetItemByEntryIDSafe = ns.GetItemFromID(entryId)
    On Error GoTo 0
End Function

Private Function FindColumnIndex(ByVal headerLine As String, ByVal colName As String, ByVal delimiter As String) As Long
    Dim i As Long
    Dim fieldVal As String
    Dim total As Long

    total = CountCsvFields(headerLine, delimiter)
    For i = 1 To total
        fieldVal = UnquoteCsvField(ExtractNthCsvField(headerLine, i, delimiter))
        If StrComp(fieldVal, colName, vbTextCompare) = 0 Then
            FindColumnIndex = i
            Exit Function
        End If
    Next i
    FindColumnIndex = 0
End Function

Private Function CountCsvFields(ByVal line As String, ByVal delimiter As String) As Long
    Dim i As Long
    Dim inQuotes As Boolean
    Dim ch As String
    Dim delim As String
    Dim cnt As Long

    If Len(line) = 0 Then
        CountCsvFields = 0
        Exit Function
    End If

    delim = delimiter
    cnt = 1
    inQuotes = False

    For i = 1 To Len(line)
        ch = Mid$(line, i, 1)
        If ch = """" Then
            If i < Len(line) And Mid$(line, i + 1, 1) = """" Then
                i = i + 1 ' escaped quote
            Else
                inQuotes = Not inQuotes
            End If
        ElseIf ch = delim And Not inQuotes Then
            cnt = cnt + 1
        End If
    Next i

    CountCsvFields = cnt
End Function

Private Function ExtractNthCsvField(ByVal line As String, ByVal nth As Long, ByVal delimiter As String) As String
    Dim i As Long
    Dim inQuotes As Boolean
    Dim ch As String
    Dim delim As String
    Dim cur As Long
    Dim result As String

    delim = delimiter
    cur = 1
    inQuotes = False
    result = ""

    For i = 1 To Len(line)
        ch = Mid$(line, i, 1)

        If ch = """" Then
            If i < Len(line) And Mid$(line, i + 1, 1) = """" Then
                If cur = nth Then result = result & """"
                i = i + 1
            Else
                inQuotes = Not inQuotes
                If cur = nth Then result = result & ch
            End If
        ElseIf ch = delim And Not inQuotes Then
            If cur = nth Then Exit For
            cur = cur + 1
        Else
            If cur = nth Then result = result & ch
        End If
    Next i

    ExtractNthCsvField = result
End Function

Private Function UnquoteCsvField(ByVal value As String) As String
    Dim s As String
    s = Trim$(value)
    If Len(s) >= 2 Then
        If Left$(s, 1) = """" And Right$(s, 1) = """" Then
            s = Mid$(s, 2, Len(s) - 2)
        End If
    End If
    s = Replace(s, """""", """")
    UnquoteCsvField = s
End Function

