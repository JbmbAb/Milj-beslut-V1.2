Option Explicit

' ============================================================
' Outlook Triage 2.1 (separat triage-CSV)
' - Bevarar idempotent manifest-flode oforandrat
' - Exporterar operativ triage med:
'   BodyHash (SHA-256), ExternalLinkDomain, FirstExternalLink,
'   AttachmentTypes, ExpiredRisk och TriageRunId
' - En rad per MailItem i vald mapp + undermappar
' ============================================================

Public Sub ScanSelectedFolderToTriageCsv()
    Dim explorer As Outlook.Explorer
    Dim rootFolder As Outlook.MAPIFolder
    Dim exportFolder As String
    Dim csvPath As String
    Dim stream As Object
    Dim fso As Object
    Dim totalCount As Long
    Dim triageRunId As String

    Dim rowBuffer As String
    Dim rowBufferCount As Long
    Dim flushEvery As Long

    Set explorer = Application.ActiveExplorer
    If explorer Is Nothing Then
        MsgBox "Ingen aktiv Outlook-vy hittades.", vbExclamation
        Exit Sub
    End If

    If explorer.CurrentFolder Is Nothing Then
        MsgBox "Ingen Outlook-mapp vald.", vbExclamation
        Exit Sub
    End If

    Set rootFolder = explorer.CurrentFolder
    exportFolder = "C:\Users\jimmy\Desktop\OutlookExport"
    csvPath = exportFolder & "\outlook_email_triage_report.csv"
    triageRunId = Format$(Now, "yyyy-mm-dd\Thh-nn-ss")

    Set fso = CreateObject("Scripting.FileSystemObject")
    If Not fso.FolderExists(exportFolder) Then
        fso.CreateFolder exportFolder
    End If

    Set stream = CreateObject("ADODB.Stream")
    stream.Type = 2 ' adTypeText
    stream.Charset = "utf-8"
    stream.Open

    stream.WriteText "TriageRunId;FolderPath;EntryID;InternetMessageId;ConversationId;ReceivedTime;SenderEmail;Subject;HasAttachments;AttachmentCount;AttachmentTypes;LinkCount;ExternalLinkDomain;FirstExternalLink;NeedsFeedback;FeeMentioned;TimeSensitive;DeadlineDetected;DeadlineDate;ExpiredRisk;Keywords;BodyHash;PriorityScore;PriorityBucket;CategorySuggestion" & vbCrLf

    totalCount = 0
    rowBuffer = ""
    rowBufferCount = 0
    flushEvery = 200

    ScanFolderRecursive rootFolder, stream, totalCount, triageRunId, rowBuffer, rowBufferCount, flushEvery
    FlushBufferedRows stream, rowBuffer, rowBufferCount

    stream.SaveToFile csvPath, 2 ' adSaveCreateOverWrite
    stream.Close

    MsgBox "Outlook Triage 2.1 klar." & vbCrLf & _
           "Skannade mejl: " & totalCount & vbCrLf & _
           "TriageRunId: " & triageRunId & vbCrLf & _
           "CSV: " & csvPath, vbInformation
End Sub

Private Sub ScanFolderRecursive(ByVal folder As Outlook.MAPIFolder, _
                                ByVal stream As Object, _
                                ByRef totalCount As Long, _
                                ByVal triageRunId As String, _
                                ByRef rowBuffer As String, _
                                ByRef rowBufferCount As Long, _
                                ByVal flushEvery As Long)
    Dim items As Outlook.Items
    Dim filteredItems As Outlook.Items
    Dim itm As Object
    Dim subFolder As Outlook.MAPIFolder

    On Error Resume Next
    Set items = folder.Items
    If Not items Is Nothing Then
        Set filteredItems = items.Restrict("[MessageClass] = 'IPM.Note'")
    End If
    On Error GoTo 0

    If Not filteredItems Is Nothing Then
        For Each itm In filteredItems
            If TypeOf itm Is Outlook.MailItem Then
                ProcessMailItem itm, folder.FolderPath, stream, triageRunId, rowBuffer, rowBufferCount, flushEvery
                totalCount = totalCount + 1
                If (totalCount Mod 200) = 0 Then DoEvents
            End If
        Next itm
    End If

    For Each subFolder In folder.Folders
        ScanFolderRecursive subFolder, stream, totalCount, triageRunId, rowBuffer, rowBufferCount, flushEvery
    Next subFolder
End Sub

Private Sub ProcessMailItem(ByVal mail As Outlook.MailItem, _
                            ByVal folderPath As String, _
                            ByVal stream As Object, _
                            ByVal triageRunId As String, _
                            ByRef rowBuffer As String, _
                            ByRef rowBufferCount As Long, _
                            ByVal flushEvery As Long)
    Dim entryId As String
    Dim internetMessageId As String
    Dim conversationId As String
    Dim senderEmail As String
    Dim subjectText As String
    Dim bodyText As String
    Dim htmlText As String
    Dim bodyNormalized As String
    Dim receivedText As String

    Dim hasAttachments As Boolean
    Dim attachmentCount As Long
    Dim attachmentTypes As String

    Dim linkCount As Long
    Dim externalDomains As String
    Dim firstExternalLink As String

    Dim needsFeedback As Boolean
    Dim feeMentioned As Boolean
    Dim timeSensitive As Boolean
    Dim deadlineDetected As Boolean
    Dim deadlineDate As String
    Dim expiredRisk As Boolean

    Dim keywordHits As String
    Dim bodyHash As String
    Dim priorityScore As Long
    Dim priorityBucket As String
    Dim categorySuggestion As String

    Dim textForSignals As String
    Dim htmlTextForSignals As String
    Dim rowText As String

    On Error Resume Next

    entryId = Nz(mail.EntryID)
    internetMessageId = GetInternetMessageId(mail)
    conversationId = Nz(mail.ConversationID)
    senderEmail = GetSenderSmtpAddress(mail)
    subjectText = Nz(mail.Subject)
    bodyText = Nz(mail.Body)
    htmlText = Nz(mail.HTMLBody)
    bodyNormalized = NormalizeForHash(htmlText, bodyText)

    receivedText = ""
    If mail.ReceivedTime <> #1/1/4501# Then
        receivedText = Format$(mail.ReceivedTime, "yyyy-mm-dd hh:nn:ss")
    End If

    attachmentCount = mail.Attachments.Count
    hasAttachments = (attachmentCount > 0)
    attachmentTypes = GetAttachmentTypes(mail.Attachments)

    GetLinkInfo mail, linkCount, externalDomains, firstExternalLink

    htmlTextForSignals = DecodeHtmlEntities(StripHtmlTags(htmlText))
    textForSignals = NormalizeForMatching(subjectText & " " & bodyText & " " & htmlTextForSignals)

    needsFeedback = ContainsAny(textForSignals, Array( _
        "vanligen aterkom", "vanligen meddela", "aterkoppla", "aterkoppling", _
        "please confirm", "please respond", "svara senast", _
        "godkanna", "acceptera", "bekrafta", "onskar svar"))

    feeMentioned = ContainsAny(textForSignals, Array( _
        "avgift", "avgifter", "kostnad", "kostnader", "debiter", _
        "faktura", "fakturering", "betalning", "betala", "utlamnandeavgift"))

    timeSensitive = ContainsAny(textForSignals, Array( _
        "lanken upphor", "lanken galler till", "giltig till", "expires", "expire", _
        "expired", "senast", "tidsbegransad", "tillfallig lank", _
        "download", "nedladdning", "hamta filerna", "lanken ar aktiv"))

    deadlineDate = DetectDeadlineDate(subjectText & " " & bodyText)
    deadlineDetected = (Len(deadlineDate) > 0) Or ContainsAny(textForSignals, Array("senast", "deadline", "giltig till", "expires"))
    expiredRisk = (linkCount > 0) And ContainsAny(textForSignals, Array("giltig till", "expires", "expire", "senast"))

    keywordHits = BuildKeywordHits(feeMentioned, needsFeedback, timeSensitive, deadlineDetected, linkCount, hasAttachments, expiredRisk)
    bodyHash = ComputeBodyHash(subjectText & "|" & receivedText & "|" & bodyNormalized)

    ' Uppdaterad poangmodell:
    ' Deadline +5, ExpiredRisk +4, NeedsFeedback +3, Fee +2, Link +1, Bilaga +1
    priorityScore = 0
    If deadlineDetected Then priorityScore = priorityScore + 5
    If expiredRisk Then priorityScore = priorityScore + 4
    If needsFeedback Then priorityScore = priorityScore + 3
    If feeMentioned Then priorityScore = priorityScore + 2
    If linkCount > 0 Then priorityScore = priorityScore + 1
    If hasAttachments Then priorityScore = priorityScore + 1

    priorityBucket = GetPriorityBucket(priorityScore)
    categorySuggestion = BuildCategorySuggestion(timeSensitive, needsFeedback, feeMentioned, linkCount, hasAttachments, expiredRisk)

    rowText = CsvField(triageRunId)
    rowText = rowText & ";" & CsvField(folderPath)
    rowText = rowText & ";" & CsvField(entryId)
    rowText = rowText & ";" & CsvField(internetMessageId)
    rowText = rowText & ";" & CsvField(conversationId)
    rowText = rowText & ";" & CsvField(receivedText)
    rowText = rowText & ";" & CsvField(senderEmail)
    rowText = rowText & ";" & CsvField(subjectText)
    rowText = rowText & ";" & CsvField(BoolToText(hasAttachments))
    rowText = rowText & ";" & CsvField(CStr(attachmentCount))
    rowText = rowText & ";" & CsvField(attachmentTypes)
    rowText = rowText & ";" & CsvField(CStr(linkCount))
    rowText = rowText & ";" & CsvField(externalDomains)
    rowText = rowText & ";" & CsvField(firstExternalLink)
    rowText = rowText & ";" & CsvField(BoolToText(needsFeedback))
    rowText = rowText & ";" & CsvField(BoolToText(feeMentioned))
    rowText = rowText & ";" & CsvField(BoolToText(timeSensitive))
    rowText = rowText & ";" & CsvField(BoolToText(deadlineDetected))
    rowText = rowText & ";" & CsvField(deadlineDate)
    rowText = rowText & ";" & CsvField(BoolToText(expiredRisk))
    rowText = rowText & ";" & CsvField(keywordHits)
    rowText = rowText & ";" & CsvField(bodyHash)
    rowText = rowText & ";" & CsvField(CStr(priorityScore))
    rowText = rowText & ";" & CsvField(priorityBucket)
    rowText = rowText & ";" & CsvField(categorySuggestion)

    AppendBufferedRow rowText, stream, rowBuffer, rowBufferCount, flushEvery

    On Error GoTo 0
End Sub

Private Sub AppendBufferedRow(ByVal rowText As String, _
                              ByVal stream As Object, _
                              ByRef rowBuffer As String, _
                              ByRef rowBufferCount As Long, _
                              ByVal flushEvery As Long)
    rowBuffer = rowBuffer & rowText & vbCrLf
    rowBufferCount = rowBufferCount + 1

    If rowBufferCount >= flushEvery Then
        stream.WriteText rowBuffer
        rowBuffer = ""
        rowBufferCount = 0
    End If
End Sub

Private Sub FlushBufferedRows(ByVal stream As Object, ByRef rowBuffer As String, ByRef rowBufferCount As Long)
    If rowBufferCount > 0 Then
        stream.WriteText rowBuffer
        rowBuffer = ""
        rowBufferCount = 0
    End If
End Sub

Private Sub GetLinkInfo(ByVal mail As Outlook.MailItem, _
                        ByRef linkCount As Long, _
                        ByRef domainList As String, _
                        ByRef firstExternalLink As String)
    Dim dictDomains As Object
    Dim html As String
    Dim bodyText As String

    Set dictDomains = CreateObject("Scripting.Dictionary")
    dictDomains.CompareMode = 1 ' vbTextCompare

    linkCount = 0
    firstExternalLink = ""
    html = Nz(mail.HTMLBody)
    bodyText = Nz(mail.Body)

    ExtractLinksFromHtml html, dictDomains, linkCount, firstExternalLink
    ExtractLinksFromText bodyText, dictDomains, linkCount, firstExternalLink

    domainList = JoinSortedDictionaryKeys(dictDomains, ";")
End Sub

Private Sub ExtractLinksFromHtml(ByVal html As String, _
                                 ByVal dictDomains As Object, _
                                 ByRef linkCount As Long, _
                                 ByRef firstExternalLink As String)
    Dim re As Object
    Dim matches As Object
    Dim m As Object
    Dim url As String
    Dim domain As String

    If Len(html) = 0 Then Exit Sub

    Set re = CreateObject("VBScript.RegExp")
    re.Global = True
    re.IgnoreCase = True
    re.Pattern = "href\s*=\s*[""']?([^'"" >]+)"

    Set matches = re.Execute(html)
    For Each m In matches
        If m.SubMatches.Count > 0 Then
            url = Trim$(CStr(m.SubMatches(0)))
            If Len(url) > 0 Then
                linkCount = linkCount + 1
                If Len(firstExternalLink) = 0 Then firstExternalLink = url
                domain = NormalizeDomain(ExtractHostFromUrl(url))
                If Len(domain) > 0 Then dictDomains(domain) = 1
            End If
        End If
    Next m
End Sub

Private Sub ExtractLinksFromText(ByVal textValue As String, _
                                 ByVal dictDomains As Object, _
                                 ByRef linkCount As Long, _
                                 ByRef firstExternalLink As String)
    Dim re As Object
    Dim matches As Object
    Dim m As Object
    Dim url As String
    Dim domain As String

    If Len(textValue) = 0 Then Exit Sub

    Set re = CreateObject("VBScript.RegExp")
    re.Global = True
    re.IgnoreCase = True
    re.Pattern = "(https?://[^\s\)\]<>""']+)"

    Set matches = re.Execute(textValue)
    For Each m In matches
        url = Trim$(CStr(m.Value))
        If Len(url) > 0 Then
            linkCount = linkCount + 1
            If Len(firstExternalLink) = 0 Then firstExternalLink = url
            domain = NormalizeDomain(ExtractHostFromUrl(url))
            If Len(domain) > 0 Then dictDomains(domain) = 1
        End If
    Next m
End Sub

Private Function GetAttachmentTypes(ByVal attachments As Outlook.Attachments) As String
    Dim dict As Object
    Dim i As Long
    Dim fileName As String
    Dim ext As String

    Set dict = CreateObject("Scripting.Dictionary")
    dict.CompareMode = 1 ' vbTextCompare

    On Error Resume Next
    For i = 1 To attachments.Count
        fileName = Nz(attachments(i).FileName)
        ext = LCase$(GetFileExtNoDot(fileName))
        If Len(ext) > 0 Then dict(ext) = 1
    Next i
    On Error GoTo 0

    GetAttachmentTypes = JoinSortedDictionaryKeys(dict, ";")
End Function

Private Function GetFileExtNoDot(ByVal fileName As String) As String
    Dim p As Long
    p = InStrRev(fileName, ".")
    If p > 0 And p < Len(fileName) Then
        GetFileExtNoDot = Mid$(fileName, p + 1)
    Else
        GetFileExtNoDot = ""
    End If
End Function

Private Function ExtractHostFromUrl(ByVal url As String) As String
    Dim tmp As String
    Dim p As Long
    Dim p2 As Long

    tmp = Trim$(LCase$(url))
    If Len(tmp) = 0 Then Exit Function

    p = InStr(tmp, "://")
    If p > 0 Then
        tmp = Mid$(tmp, p + 3)
    End If

    p2 = InStr(tmp, "/")
    If p2 > 0 Then tmp = Left$(tmp, p2 - 1)
    p2 = InStr(tmp, "?")
    If p2 > 0 Then tmp = Left$(tmp, p2 - 1)
    p2 = InStr(tmp, "#")
    If p2 > 0 Then tmp = Left$(tmp, p2 - 1)
    p2 = InStr(tmp, ":")
    If p2 > 0 Then tmp = Left$(tmp, p2 - 1)

    ExtractHostFromUrl = Trim$(tmp)
End Function

Private Function NormalizeDomain(ByVal host As String) As String
    Dim parts() As String
    Dim n As Long
    Dim lastTwo As String

    host = LCase$(Trim$(host))
    If Len(host) = 0 Then Exit Function

    ' Sarskild hantering av Microsoft-delning
    If host = "1drv.ms" Then
        NormalizeDomain = "1drv.ms"
        Exit Function
    End If
    If host Like "*.onedrive.live.com" Or host = "onedrive.live.com" Then
        NormalizeDomain = "onedrive.live.com"
        Exit Function
    End If
    If host Like "*.sharepoint.com" Or host Like "*-my.sharepoint.com" Or host = "sharepoint.com" Then
        NormalizeDomain = "sharepoint.com"
        Exit Function
    End If

    parts = Split(host, ".")
    n = UBound(parts) - LBound(parts) + 1
    If n <= 2 Then
        NormalizeDomain = host
        Exit Function
    End If

    lastTwo = parts(UBound(parts) - 1) & "." & parts(UBound(parts))
    NormalizeDomain = lastTwo
End Function

Private Function DetectDeadlineDate(ByVal textValue As String) As String
    Dim reIso As Object
    Dim reLocal As Object
    Dim m As Object
    Dim token As String

    On Error Resume Next

    Set reIso = CreateObject("VBScript.RegExp")
    reIso.Global = False
    reIso.IgnoreCase = True
    reIso.Pattern = "\b(20\d{2}[-/\.]\d{1,2}[-/\.]\d{1,2})\b"
    If reIso.Test(textValue) Then
        Set m = reIso.Execute(textValue)(0)
        token = Replace(Replace(CStr(m.SubMatches(0)), ".", "-"), "/", "-")
        DetectDeadlineDate = token
        Exit Function
    End If

    Set reLocal = CreateObject("VBScript.RegExp")
    reLocal.Global = False
    reLocal.IgnoreCase = True
    reLocal.Pattern = "\b(\d{1,2}[-/\.]\d{1,2}[-/\.](?:20)?\d{2})\b"
    If reLocal.Test(textValue) Then
        Set m = reLocal.Execute(textValue)(0)
        token = Replace(Replace(CStr(m.SubMatches(0)), ".", "-"), "/", "-")
        DetectDeadlineDate = token
        Exit Function
    End If

    DetectDeadlineDate = ""
    On Error GoTo 0
End Function

Private Function BuildKeywordHits(ByVal feeMentioned As Boolean, _
                                  ByVal needsFeedback As Boolean, _
                                  ByVal timeSensitive As Boolean, _
                                  ByVal deadlineDetected As Boolean, _
                                  ByVal linkCount As Long, _
                                  ByVal hasAttachments As Boolean, _
                                  ByVal expiredRisk As Boolean) As String
    Dim parts As Collection
    Dim result As String
    Dim i As Long

    Set parts = New Collection
    If feeMentioned Then parts.Add "avgift"
    If needsFeedback Then parts.Add "aterkoppling"
    If timeSensitive Then parts.Add "tidskansligt"
    If deadlineDetected Then parts.Add "deadline"
    If linkCount > 0 Then parts.Add "har_lank"
    If hasAttachments Then parts.Add "har_bilaga"
    If expiredRisk Then parts.Add "expired_risk"

    For i = 1 To parts.Count
        If result <> "" Then result = result & ";"
        result = result & CStr(parts(i))
    Next i

    BuildKeywordHits = result
End Function

Private Function BuildCategorySuggestion(ByVal timeSensitive As Boolean, _
                                         ByVal needsFeedback As Boolean, _
                                         ByVal feeMentioned As Boolean, _
                                         ByVal linkCount As Long, _
                                         ByVal hasAttachments As Boolean, _
                                         ByVal expiredRisk As Boolean) As String
    Dim parts As Collection
    Dim result As String
    Dim i As Long

    Set parts = New Collection
    If timeSensitive Then parts.Add "TIDSKANSLIGT"
    If needsFeedback Then parts.Add "ATERKOPPLING"
    If feeMentioned Then parts.Add "AVGIFT"
    If expiredRisk Then parts.Add "EXPIRED_RISK"
    If linkCount > 0 Then parts.Add "HAR_LANK"
    If hasAttachments Then parts.Add "HAR_BILAGA"

    If parts.Count = 0 Then
        BuildCategorySuggestion = "OVRIGT"
        Exit Function
    End If

    For i = 1 To parts.Count
        If result <> "" Then result = result & ";"
        result = result & CStr(parts(i))
    Next i

    BuildCategorySuggestion = result
End Function

Private Function GetPriorityBucket(ByVal score As Long) As String
    If score >= 8 Then
        GetPriorityBucket = "P1"
    ElseIf score >= 4 Then
        GetPriorityBucket = "P2"
    Else
        GetPriorityBucket = "P3"
    End If
End Function

Private Function NormalizeForHash(ByVal htmlText As String, ByVal plainText As String) As String
    Dim s As String

    If Len(Trim$(htmlText)) > 0 Then
        s = StripHtmlTags(htmlText)
        s = DecodeHtmlEntities(s)
    Else
        s = plainText
    End If

    s = Replace(s, vbCrLf, " ")
    s = Replace(s, vbCr, " ")
    s = Replace(s, vbLf, " ")
    s = CollapseWhitespace(s)
    NormalizeForHash = Trim$(s)
End Function

Private Function StripHtmlTags(ByVal htmlText As String) As String
    Dim re As Object
    Set re = CreateObject("VBScript.RegExp")
    re.Global = True
    re.IgnoreCase = True
    re.Pattern = "<[^>]+>"
    StripHtmlTags = re.Replace(htmlText, " ")
End Function

Private Function DecodeHtmlEntities(ByVal textValue As String) As String
    Dim s As String
    Dim reDec As Object
    Dim reHex As Object
    Dim matches As Object
    Dim m As Object
    Dim token As String
    Dim codePoint As Long

    s = textValue
    s = Replace(s, "&nbsp;", " ")
    s = Replace(s, "&nbsp", " ")
    s = Replace(s, "&amp;", "&")
    s = Replace(s, "&quot;", """")
    s = Replace(s, "&apos;", "'")
    s = Replace(s, "&#39;", "'")
    s = Replace(s, "&lt;", "<")
    s = Replace(s, "&gt;", ">")

    Set reDec = CreateObject("VBScript.RegExp")
    reDec.Global = True
    reDec.IgnoreCase = True
    reDec.Pattern = "&#(\d+);"
    Set matches = reDec.Execute(s)
    For Each m In matches
        token = CStr(m.SubMatches(0))
        If IsNumeric(token) Then
            codePoint = CLng(token)
            If codePoint >= 0 And codePoint <= 65535 Then
                s = Replace(s, m.Value, ChrW(codePoint))
            End If
        End If
    Next m

    Set reHex = CreateObject("VBScript.RegExp")
    reHex.Global = True
    reHex.IgnoreCase = True
    reHex.Pattern = "&#x([0-9a-f]+);"
    Set matches = reHex.Execute(s)
    For Each m In matches
        token = CStr(m.SubMatches(0))
        codePoint = HexToLong(token)
        If codePoint >= 0 And codePoint <= 65535 Then
            s = Replace(s, m.Value, ChrW(codePoint))
        End If
    Next m

    DecodeHtmlEntities = s
End Function

Private Function HexToLong(ByVal hexValue As String) As Long
    On Error GoTo Fail
    HexToLong = CLng("&H" & hexValue)
    Exit Function
Fail:
    HexToLong = -1
End Function

Private Function CollapseWhitespace(ByVal textValue As String) As String
    Dim re As Object
    Set re = CreateObject("VBScript.RegExp")
    re.Global = True
    re.Pattern = "\s+"
    CollapseWhitespace = re.Replace(textValue, " ")
End Function

Private Function ComputeBodyHash(ByVal inputText As String) As String
    Dim hashValue As String
    hashValue = SHA256ViaDotNet(inputText)
    If Len(hashValue) = 64 Then
        ComputeBodyHash = hashValue
        Exit Function
    End If

    hashValue = SHA256ViaCertUtil(inputText)
    If Len(hashValue) = 64 Then
        ComputeBodyHash = hashValue
    Else
        ComputeBodyHash = "ERROR"
    End If
End Function

Private Function SHA256ViaDotNet(ByVal inputText As String) As String
    Dim enc As Object
    Dim sha As Object
    Dim bytes As Variant
    Dim hashBytes As Variant
    Dim i As Long
    Dim result As String

    On Error GoTo Fail
    Set enc = CreateObject("System.Text.UTF8Encoding")
    Set sha = CreateObject("System.Security.Cryptography.SHA256Managed")
    bytes = enc.GetBytes_4(inputText)
    hashBytes = sha.ComputeHash_2((bytes))

    For i = LBound(hashBytes) To UBound(hashBytes)
        result = result & Right$("0" & Hex(hashBytes(i)), 2)
    Next i

    SHA256ViaDotNet = LCase$(result)
    Exit Function
Fail:
    SHA256ViaDotNet = ""
End Function

Private Function SHA256ViaCertUtil(ByVal inputText As String) As String
    Dim fso As Object
    Dim wsh As Object
    Dim textStream As Object
    Dim tempIn As String
    Dim tempOut As String
    Dim cmd As String
    Dim outputText As String
    Dim lines() As String
    Dim i As Long
    Dim lineClean As String

    On Error GoTo Fail

    Set fso = CreateObject("Scripting.FileSystemObject")
    Set wsh = CreateObject("WScript.Shell")

    tempIn = fso.GetSpecialFolder(2) & "\" & fso.GetTempName
    tempOut = fso.GetSpecialFolder(2) & "\" & fso.GetTempName

    Set textStream = CreateObject("ADODB.Stream")
    textStream.Type = 2 ' adTypeText
    textStream.Charset = "utf-8"
    textStream.Open
    textStream.WriteText inputText
    textStream.SaveToFile tempIn, 2
    textStream.Close

    cmd = "cmd /c certutil -hashfile """ & tempIn & """ SHA256 > """ & tempOut & """"
    wsh.Run cmd, 0, True

    If Not fso.FileExists(tempOut) Then GoTo Fail
    outputText = fso.OpenTextFile(tempOut, 1).ReadAll

    lines = Split(outputText, vbCrLf)
    For i = LBound(lines) To UBound(lines)
        lineClean = Replace(Trim$(lines(i)), " ", "")
        If Len(lineClean) = 64 Then
            If Not lineClean Like "*[!0-9A-Fa-f]*" Then
                SHA256ViaCertUtil = LCase$(lineClean)
                GoTo Cleanup
            End If
        End If
    Next i

Fail:
    SHA256ViaCertUtil = ""

Cleanup:
    On Error Resume Next
    If Len(tempIn) > 0 And fso.FileExists(tempIn) Then fso.DeleteFile tempIn, True
    If Len(tempOut) > 0 And fso.FileExists(tempOut) Then fso.DeleteFile tempOut, True
    On Error GoTo 0
End Function

Private Function JoinSortedDictionaryKeys(ByVal dict As Object, ByVal delimiter As String) As String
    Dim keys As Variant
    Dim i As Long
    Dim j As Long
    Dim tmp As String
    Dim result As String

    If dict Is Nothing Then Exit Function
    If dict.Count = 0 Then Exit Function

    keys = dict.Keys

    For i = LBound(keys) To UBound(keys) - 1
        For j = i + 1 To UBound(keys)
            If CStr(keys(j)) < CStr(keys(i)) Then
                tmp = CStr(keys(i))
                keys(i) = CStr(keys(j))
                keys(j) = tmp
            End If
        Next j
    Next i

    For i = LBound(keys) To UBound(keys)
        If result <> "" Then result = result & delimiter
        result = result & CStr(keys(i))
    Next i

    JoinSortedDictionaryKeys = result
End Function

Private Function GetInternetMessageId(ByVal mail As Outlook.MailItem) As String
    On Error Resume Next
    GetInternetMessageId = Nz(mail.PropertyAccessor.GetProperty("http://schemas.microsoft.com/mapi/proptag/0x1035001E"))
    On Error GoTo 0
End Function

Private Function GetSenderSmtpAddress(ByVal mail As Outlook.MailItem) As String
    On Error GoTo Fallback

    If mail.SenderEmailType = "EX" Then
        Dim exchUser As Outlook.ExchangeUser
        Set exchUser = mail.Sender.GetExchangeUser
        If Not exchUser Is Nothing Then
            GetSenderSmtpAddress = Nz(exchUser.PrimarySmtpAddress)
            If Len(GetSenderSmtpAddress) > 0 Then Exit Function
        End If
    End If

    GetSenderSmtpAddress = Nz(mail.SenderEmailAddress)
    Exit Function

Fallback:
    GetSenderSmtpAddress = Nz(mail.SenderEmailAddress)
End Function

Private Function ContainsAny(ByVal textValue As String, ByVal keywords As Variant) As Boolean
    Dim i As Long
    For i = LBound(keywords) To UBound(keywords)
        If InStr(1, textValue, LCase$(CStr(keywords(i))), vbTextCompare) > 0 Then
            ContainsAny = True
            Exit Function
        End If
    Next i
    ContainsAny = False
End Function

Private Function NormalizeForMatching(ByVal textValue As String) As String
    Dim s As String
    s = LCase$(textValue)

    s = Replace(s, "å", "a")
    s = Replace(s, "ä", "a")
    s = Replace(s, "ö", "o")
    s = Replace(s, "é", "e")
    s = Replace(s, "è", "e")
    s = Replace(s, "ê", "e")
    s = Replace(s, "ü", "u")
    s = Replace(s, "á", "a")
    s = Replace(s, "à", "a")
    s = Replace(s, "ó", "o")
    s = Replace(s, "ò", "o")

    s = Replace(s, vbCrLf, " ")
    s = Replace(s, vbCr, " ")
    s = Replace(s, vbLf, " ")

    NormalizeForMatching = CollapseWhitespace(s)
End Function

Private Function Nz(ByVal value As Variant) As String
    If IsNull(value) Or IsEmpty(value) Then
        Nz = ""
    Else
        Nz = CStr(value)
    End If
End Function

Private Function BoolToText(ByVal value As Boolean) As String
    If value Then
        BoolToText = "TRUE"
    Else
        BoolToText = "FALSE"
    End If
End Function

Private Function CsvField(ByVal value As String) As String
    Dim s As String
    s = value

    ' CSV-sakerhet for Excel:
    ' 1) Ta bort radbrytningar
    ' 2) Prefixa formel-liknande innehall med apostrof
    s = Replace(s, vbCrLf, " ")
    s = Replace(s, vbCr, " ")
    s = Replace(s, vbLf, " ")

    If Len(s) > 0 Then
        Select Case Left$(s, 1)
            Case "=", "+", "-", "@"
                s = "'" & s
        End Select
    End If

    CsvField = """" & Replace(s, """", """""") & """"
End Function
