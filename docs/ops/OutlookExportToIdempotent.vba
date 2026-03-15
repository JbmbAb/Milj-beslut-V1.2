Option Explicit

Public Sub ExportEmailsForIdempotentIngest()
    Dim objNamespace As Outlook.NameSpace
    Dim rootFolder As Outlook.MAPIFolder
    Dim adodbStream As Object
    Dim fso As Object
    Dim exportFolder As String
    Dim csvPath As String
    Dim countMails As Long
    Dim countAttachments As Long

    exportFolder = "C:\Users\jimmy\Desktop\OutlookExport"

    Set objNamespace = Application.GetNamespace("MAPI")
    If Application.ActiveExplorer Is Nothing Then
        MsgBox "Ingen aktiv Outlook-vy hittades.", vbExclamation
        Exit Sub
    End If

    Set rootFolder = Application.ActiveExplorer.CurrentFolder
    If rootFolder Is Nothing Then
        MsgBox "Ingen Outlook-mapp vald.", vbExclamation
        Exit Sub
    End If

    Set fso = CreateObject("Scripting.FileSystemObject")
    If Not fso.FolderExists(exportFolder) Then
        fso.CreateFolder exportFolder
    End If

    csvPath = exportFolder & "\manifest.csv"

    Set adodbStream = CreateObject("ADODB.Stream")
    adodbStream.Type = 2 ' adTypeText
    adodbStream.Charset = "utf-8"
    adodbStream.Open
    adodbStream.WriteText "message_id;sender;subject;received_at;filename;stored_path;kommunnamn;body_preview" & vbCrLf

    countMails = 0
    countAttachments = 0

    ExportFolderRecursive rootFolder, adodbStream, exportFolder, countMails, countAttachments

    adodbStream.SaveToFile csvPath, 2 ' adSaveCreateOverWrite
    adodbStream.Close

    MsgBox "Export 2.1 klar!" & vbCrLf & _
           "Skannade mejl: " & countMails & vbCrLf & _
           "Relevanta bilagor: " & countAttachments & vbCrLf & _
           "Rotmapp: " & rootFolder.FolderPath & vbCrLf & _
           "Scope: vald mapp + undermappar" & vbCrLf & _
           "CSV: " & csvPath, vbInformation
End Sub

Private Sub ExportFolderRecursive(ByVal objFolder As Outlook.MAPIFolder, _
                                  ByVal adodbStream As Object, _
                                  ByVal exportFolder As String, _
                                  ByRef countMails As Long, _
                                  ByRef countAttachments As Long)
    Dim items As Outlook.Items
    Dim filteredItems As Outlook.Items
    Dim objItem As Object
    Dim subFolder As Outlook.MAPIFolder

    On Error Resume Next
    Set items = objFolder.Items
    If Not items Is Nothing Then
        Set filteredItems = items.Restrict("[MessageClass] = 'IPM.Note'")
    End If
    On Error GoTo 0

    If Not filteredItems Is Nothing Then
        For Each objItem In filteredItems
            If TypeOf objItem Is Outlook.MailItem Then
                ExportSingleMailItem objItem, adodbStream, exportFolder, countMails, countAttachments
                If (countMails Mod 200) = 0 Then DoEvents
            End If
        Next objItem
    End If

    For Each subFolder In objFolder.Folders
        ExportFolderRecursive subFolder, adodbStream, exportFolder, countMails, countAttachments
    Next subFolder
End Sub

Private Sub ExportSingleMailItem(ByVal objMail As Outlook.MailItem, _
                                 ByVal adodbStream As Object, _
                                 ByVal exportFolder As String, _
                                 ByRef countMails As Long, _
                                 ByRef countAttachments As Long)
    Dim objAttachment As Outlook.Attachment
    Dim msgId As String
    Dim senderName As String
    Dim subjectStr As String
    Dim receivedTime As String
    Dim kommun As String
    Dim realEmail As String
    Dim bodyPreview As String
    Dim hasValidAttached As Boolean
    Dim safeFileName As String
    Dim savePath As String

    msgId = objMail.EntryID
    realEmail = objMail.SenderEmailAddress

    If objMail.SenderEmailType = "EX" Then
        On Error Resume Next
        realEmail = objMail.Sender.GetExchangeUser().PrimarySmtpAddress
        If realEmail = "" Then realEmail = objMail.SenderEmailAddress
        On Error GoTo 0
    End If

    senderName = Replace(realEmail, ";", ",")
    subjectStr = Replace(Replace(objMail.Subject, ";", ","), vbCrLf, " ")
    receivedTime = Format(objMail.ReceivedTime, "yyyy-mm-dd hh:mm:ss")

    bodyPreview = ""
    On Error Resume Next
    bodyPreview = Left(objMail.Body, 200)
    bodyPreview = Replace(Replace(Replace(bodyPreview, vbCrLf, " "), vbCr, " "), vbLf, " ")
    bodyPreview = Replace(bodyPreview, ";", ",")
    On Error GoTo 0

    kommun = ExtractKommun(senderName)
    countMails = countMails + 1

    If objMail.Attachments.Count > 0 Then
        hasValidAttached = False

        For Each objAttachment In objMail.Attachments
            safeFileName = CleanFileName(objAttachment.FileName)

            If IsRelevantAttachment(safeFileName) Then
                savePath = exportFolder & "\" & Left(msgId, 15) & "_" & safeFileName

                On Error Resume Next
                objAttachment.SaveAsFile savePath
                If Err.Number = 0 Then
                    adodbStream.WriteText msgId & ";" & senderName & ";" & subjectStr & ";" & receivedTime & ";" & safeFileName & ";" & savePath & ";" & kommun & ";" & bodyPreview & vbCrLf
                    hasValidAttached = True
                    countAttachments = countAttachments + 1
                End If
                Err.Clear
                On Error GoTo 0
            End If
        Next objAttachment

        If Not hasValidAttached Then
            adodbStream.WriteText msgId & ";" & senderName & ";" & subjectStr & ";" & receivedTime & ";;;" & kommun & ";" & bodyPreview & vbCrLf
        End If
    Else
        adodbStream.WriteText msgId & ";" & senderName & ";" & subjectStr & ";" & receivedTime & ";;;" & kommun & ";" & bodyPreview & vbCrLf
    End If
End Sub

Private Function IsRelevantAttachment(ByVal safeFileName As String) As Boolean
    Dim fileExt As String

    fileExt = LCase$(safeFileName)
    IsRelevantAttachment = (Right$(fileExt, 4) = ".pdf" Or _
                            Right$(fileExt, 5) = ".docx" Or _
                            Right$(fileExt, 4) = ".doc" Or _
                            Right$(fileExt, 4) = ".zip" Or _
                            Right$(fileExt, 4) = ".msg")
End Function

Function CleanFileName(strName As String) As String
    Dim invalidChars As String
    Dim i As Integer

    If Len(strName) = 0 Then
        CleanFileName = "untitled"
        Exit Function
    End If

    invalidChars = "\/:*?""<>|;"
    For i = 1 To Len(invalidChars)
        strName = Replace(strName, Mid$(invalidChars, i, 1), "_")
    Next i

    strName = Replace(strName, vbCrLf, "")
    strName = Replace(strName, vbCr, "")
    strName = Replace(strName, vbLf, "")

    CleanFileName = Trim$(strName)
End Function

Function ExtractKommun(ByVal email As String) As String
    Dim atPos As Integer
    Dim domain As String

    If Len(email) = 0 Then
        ExtractKommun = ""
        Exit Function
    End If

    atPos = InStrRev(email, "@")
    If atPos > 0 Then
        domain = Mid$(email, atPos + 1)
        domain = Replace(LCase$(domain), ".se", "")
        ExtractKommun = Trim$(domain)
    Else
        ExtractKommun = ""
    End If
End Function
