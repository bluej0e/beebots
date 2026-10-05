' Starts scripts/start-all.mjs with no console window. Run by the "beebots" scheduled task at logon.
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = root
sh.Run """C:\Program Files\nodejs\node.exe"" """ & root & "\scripts\start-all.mjs""", 0, False
