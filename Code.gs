// ─── Config ───────────────────────────────────────────────────────────────────
// Paste your Google Spreadsheet ID here (from the URL: /spreadsheets/d/SPREADSHEET_ID/edit)
var SPREADSHEET_ID = '1Bbactptn3ciyuA3jVEmTC5a7paEDncuiE-kAwBn9P4o';

// ─── API Secret Token ────────────────────────────────────────────────────────
// Must match the API_SECRET value in index.html exactly
var API_SECRET = 'lrc_7x$Kp2@mNqR9vZwT4jHbYuE8dF1oXs';

function validateSecret(secret) {
  return secret === API_SECRET;
}

function getSpreadsheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

// ─── Sheet Helpers ───────────────────────────────────────────────────────────

function getUsersSheet() {
  return getSpreadsheet().getSheetByName('Users');
}

function getXMLSheet() {
  return getSpreadsheet().getSheetByName('XML_Files');
}

function setupSheets() {
  var ss = getSpreadsheet();

  var usersSheet = ss.getSheetByName('Users');
  if (!usersSheet) {
    usersSheet = ss.insertSheet('Users');
    usersSheet.appendRow(['User_ID', 'Username', 'Email', 'Password_Hash', 'Created_At']);
  }

  var xmlSheet = ss.getSheetByName('XML_Files');
  if (!xmlSheet) {
    xmlSheet = ss.insertSheet('XML_Files');
    xmlSheet.appendRow(['File_ID', 'User_ID', 'File_Name', 'Created_At']);
  }
}

// ─── Password Hashing ────────────────────────────────────────────────────────

function hashPassword(password) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    password,
    Utilities.Charset.UTF_8
  );
  var hex = bytes.map(function (b) {
    var byte = b < 0 ? b + 256 : b;
    return ('0' + byte.toString(16)).slice(-2);
  }).join('');
  return hex;
}

// ─── User Registration ───────────────────────────────────────────────────────

var DEFAULT_AVATAR = '🐱';

function registerUser(username, password, email) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sheet = getUsersSheet();
    var data = sheet.getDataRange().getValues();

    var emailLower    = email.toLowerCase().trim();
    var usernameLower = username.toLowerCase().trim();

    for (var i = 1; i < data.length; i++) {
      var rowUsername = (data[i][1] || '').toString().toLowerCase().trim();
      var rowEmail    = (data[i][2] || '').toString().toLowerCase().trim();

      if (rowUsername === usernameLower) {
        return { success: false, message: 'Username already exists.' };
      }
      if (rowEmail !== '' && rowEmail === emailLower) {
        return { success: false, message: 'This Gmail is already registered.' };
      }
    }

    var userId = Utilities.getUuid();
    var passwordHash = hashPassword(password);
    var createdAt = new Date().toISOString();

    sheet.appendRow([userId, username, email, passwordHash, createdAt, DEFAULT_AVATAR]);

    return { success: true, message: 'User registered successfully.', userId: userId };
  } catch (err) {
    return { success: false, message: err.toString() };
  } finally {
    lock.releaseLock();
  }
}

// ─── User Login ──────────────────────────────────────────────────────────────

function loginUser(email, password) {
  try {
    var sheet = getUsersSheet();
    var data = sheet.getDataRange().getValues();
    var inputHash = hashPassword(password);
    var emailLower = email.toLowerCase().trim();

    for (var i = 1; i < data.length; i++) {
      var rowEmail = (data[i][2] || '').toString().toLowerCase().trim();
      if (rowEmail === emailLower) {
        if (data[i][3].toString() === inputHash) {
          return {
            success: true,
            message: 'Login successful.',
            userId: data[i][0].toString(),
            username: data[i][1].toString(),
            avatar: data[i][5] ? data[i][5].toString() : DEFAULT_AVATAR
          };
        } else {
          return { success: false, message: 'Incorrect password.' };
        }
      }
    }

    return { success: false, message: 'Gmail not found.' };
  } catch (err) {
    return { success: false, message: err.toString() };
  }
}

// ─── Drive Folder Helper ─────────────────────────────────────────────────────

function getUserDriveFolder(userId) {
  var rootName = 'LyricsEncoder_Files';
  var roots = DriveApp.getFoldersByName(rootName);
  var root = roots.hasNext() ? roots.next() : DriveApp.createFolder(rootName);
  var userFolders = root.getFoldersByName(userId);
  return userFolders.hasNext() ? userFolders.next() : root.createFolder(userId);
}

// ─── Save XML File (to Google Drive) ────────────────────────────────────────

function saveXML(userId, fileName, xmlContent, encoded) {
  try {
    if (!userId)     return { success: false, message: 'Missing userId.' };
    if (!fileName)   return { success: false, message: 'Missing fileName.' };
    if (!xmlContent) return { success: false, message: 'Missing xmlContent.' };

    // Decode base64 if encoded flag is set
    var content = encoded
      ? Utilities.newBlob(Utilities.base64Decode(xmlContent)).getDataAsString('UTF-8')
      : xmlContent;

    var folder = getUserDriveFolder(userId);
    var file = folder.createFile(fileName, content, MimeType.PLAIN_TEXT);
    var driveFileId = file.getId();
    var createdAt = new Date().toISOString();

    var sheet = getXMLSheet();
    sheet.appendRow([driveFileId, userId, fileName, createdAt]);

    return { success: true, fileId: driveFileId };
  } catch (err) {
    return { success: false, message: err.toString() };
  }
}

// ─── Get User XML Files ──────────────────────────────────────────────────────

function getUserXMLFiles(userId) {
  try {
    var sheet = getXMLSheet();
    var data = sheet.getDataRange().getValues();
    var files = [];

    for (var i = 1; i < data.length; i++) {
      if (data[i][1].toString() === userId) {
        files.push({
          fileId:    data[i][0].toString(),
          fileName:  data[i][2].toString(),
          createdAt: data[i][3].toString()
        });
      }
    }

    return { success: true, files: files };
  } catch (err) {
    return { success: false, message: err.toString() };
  }
}

// ─── Get XML Content (from Google Drive) ────────────────────────────────────

function getXMLContent(fileId, userId) {
  try {
    // Verify ownership via sheet
    var sheet = getXMLSheet();
    var data = sheet.getDataRange().getValues();
    var owned = false;
    for (var i = 1; i < data.length; i++) {
      if (data[i][0].toString() === fileId) {
        if (data[i][1].toString() !== userId)
          return { success: false, message: 'Access denied.' };
        owned = true; break;
      }
    }
    if (!owned) return { success: false, message: 'File not found.' };

    var file = DriveApp.getFileById(fileId);
    var xmlContent = file.getBlob().getDataAsString();
    return { success: true, xmlContent: xmlContent };
  } catch (err) {
    return { success: false, message: err.toString() };
  }
}

// ─── Delete XML File ─────────────────────────────────────────────────────────

function deleteXMLFile(fileId, userId) {
  try {
    var sheet = getXMLSheet();
    var data = sheet.getDataRange().getValues();

    for (var i = 1; i < data.length; i++) {
      if (data[i][0].toString() === fileId) {
        if (data[i][1].toString() !== userId)
          return { success: false, message: 'Access denied.' };
        // Delete from Drive
        try { DriveApp.getFileById(fileId).setTrashed(true); } catch(e) {}
        // Remove from sheet
        sheet.deleteRow(i + 1);
        return { success: true, message: 'File deleted.' };
      }
    }

    return { success: false, message: 'File not found.' };
  } catch (err) {
    return { success: false, message: err.toString() };
  }
}

// ─── Rename XML File ─────────────────────────────────────────────────────────

function renameXMLFile(fileId, userId, newName) {
  try {
    if (!newName || newName.trim() === '')
      return { success: false, message: 'New name cannot be empty.' };

    var sheet = getXMLSheet();
    var data  = sheet.getDataRange().getValues();

    for (var i = 1; i < data.length; i++) {
      if (data[i][0].toString() === fileId) {
        if (data[i][1].toString() !== userId)
          return { success: false, message: 'Access denied.' };
        // Rename on Drive
        try { DriveApp.getFileById(fileId).setName(newName.trim()); } catch(e) {}
        // Update sheet
        sheet.getRange(i + 1, 3).setValue(newName.trim());
        return { success: true, message: 'File renamed.' };
      }
    }
    return { success: false, message: 'File not found.' };
  } catch (err) {
    return { success: false, message: err.toString() };
  }
}

// ─── Check Email Availability ────────────────────────────────────────────────

function checkEmailAvailable(email) {
  try {
    var sheet = getUsersSheet();
    var data  = sheet.getDataRange().getValues();
    var emailLower = email.toLowerCase().trim();
    for (var i = 1; i < data.length; i++) {
      var rowEmail = (data[i][2] || '').toString().toLowerCase().trim();
      if (rowEmail !== '' && rowEmail === emailLower) {
        return { success: false, message: 'This Gmail is already registered.' };
      }
    }
    return { success: true };
  } catch (err) {
    return { success: false, message: err.toString() };
  }
}

// ─── Update Avatar ───────────────────────────────────────────────────────────

function updateAvatar(userId, avatar) {
  try {
    var sheet = getUsersSheet();
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0].toString() === userId) {
        sheet.getRange(i + 1, 6).setValue(avatar); // column 6 = Avatar
        return { success: true };
      }
    }
    return { success: false, message: 'User not found.' };
  } catch (err) {
    return { success: false, message: err.toString() };
  }
}

// ─── Change Password ─────────────────────────────────────────────────────────

function changePassword(userId, oldPassword, newPassword) {
  try {
    var sheet = getUsersSheet();
    var data = sheet.getDataRange().getValues();
    var oldHash = hashPassword(oldPassword);

    for (var i = 1; i < data.length; i++) {
      if (data[i][0].toString() === userId) {
        if (data[i][3].toString() !== oldHash) {
          return { success: false, message: 'Old password is incorrect.' };
        }
        var newHash = hashPassword(newPassword);
        sheet.getRange(i + 1, 4).setValue(newHash);
        return { success: true, message: 'Password updated successfully.' };
      }
    }

    return { success: false, message: 'User not found.' };
  } catch (err) {
    return { success: false, message: err.toString() };
  }
}

// ─── Change Username ─────────────────────────────────────────────────────────

function changeUsername(userId, newUsername, password) {
  try {
    var sheet = getUsersSheet();
    var data = sheet.getDataRange().getValues();
    var inputHash = hashPassword(password);

    for (var i = 1; i < data.length; i++) {
      if (data[i][1].toString().toLowerCase() === newUsername.toLowerCase()) {
        if (data[i][0].toString() !== userId) {
          return { success: false, message: 'Username already taken.' };
        }
      }
    }

    for (var j = 1; j < data.length; j++) {
      if (data[j][0].toString() === userId) {
        if (data[j][3].toString() !== inputHash) {
          return { success: false, message: 'Password is incorrect.' };
        }
        sheet.getRange(j + 1, 2).setValue(newUsername);
        return { success: true, message: 'Username updated successfully.' };
      }
    }

    return { success: false, message: 'User not found.' };
  } catch (err) {
    return { success: false, message: err.toString() };
  }
}

// ─── Delete Account ──────────────────────────────────────────────────────────

function deleteAccount(userId, password) {
  try {
    var usersSheet = getUsersSheet();
    var userData = usersSheet.getDataRange().getValues();
    var inputHash = hashPassword(password);
    var userRowIndex = -1;

    for (var i = 1; i < userData.length; i++) {
      if (userData[i][0].toString() === userId) {
        if (userData[i][3].toString() !== inputHash) {
          return { success: false, message: 'Password is incorrect.' };
        }
        userRowIndex = i + 1;
        break;
      }
    }

    if (userRowIndex === -1) {
      return { success: false, message: 'User not found.' };
    }

    var xmlSheet = getXMLSheet();
    var xmlData = xmlSheet.getDataRange().getValues();

    for (var k = xmlData.length - 1; k >= 1; k--) {
      if (xmlData[k][1].toString() === userId) {
        xmlSheet.deleteRow(k + 1);
      }
    }

    usersSheet.deleteRow(userRowIndex);

    return { success: true, message: 'Account and all associated files deleted.' };
  } catch (err) {
    return { success: false, message: err.toString() };
  }
}

// ─── Web App Entry Points ────────────────────────────────────────────────────

function doGet(e) {
  // First-time setup (no action = health check)
  if (!e || !e.parameter || !e.parameter.action) {
    setupSheets();
    return HtmlService.createHtmlOutput('<h2>API is running ✓</h2>');
  }

  try {
    var action = e.parameter.action;
    var params = JSON.parse(e.parameter.data || '{}');
    var result;

    // ── Secret token check ──────────────────────────────────────────────────
    if (!validateSecret(params._secret)) {
      return ContentService
        .createTextOutput(JSON.stringify({ success: false, message: 'Unauthorized.' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    switch (action) {
      case 'register':
        result = registerUser(params.username, params.password, params.email);
        break;
      case 'login':
        result = loginUser(params.email, params.password);
        break;
      case 'saveXML':
        result = saveXML(params.userId, params.fileName, params.xmlContent, params.encoded);
        break;
      case 'getXMLFiles':
        result = getUserXMLFiles(params.userId);
        break;
      case 'getXMLContent':
        result = getXMLContent(params.fileId, params.userId);
        break;
      case 'deleteXML':
        result = deleteXMLFile(params.fileId, params.userId);
        break;
      case 'renameXML':
        result = renameXMLFile(params.fileId, params.userId, params.newName);
        break;
      case 'changePassword':
        result = changePassword(params.userId, params.oldPassword, params.newPassword);
        break;
      case 'changeUsername':
        result = changeUsername(params.userId, params.newUsername, params.password);
        break;
      case 'deleteAccount':
        result = deleteAccount(params.userId, params.password);
        break;
      case 'updateAvatar':
        result = updateAvatar(params.userId, params.avatar);
        break;
      case 'checkEmail':
        result = checkEmailAvailable(params.email);
        break;
      default:
        result = { success: false, message: 'Unknown action: ' + action };
    }

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  try {
    var params = JSON.parse(e.postData.contents);
    var action = params.action;
    var result;

    // ── Secret token check ──────────────────────────────────────────────────
    if (!validateSecret(params._secret)) {
      return ContentService
        .createTextOutput(JSON.stringify({ success: false, message: 'Unauthorized.' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    switch (action) {
      case 'register':
        result = registerUser(params.username, params.password, params.email);
        break;

      case 'login':
        result = loginUser(params.email, params.password);
        break;

      case 'saveXML':
        result = saveXML(params.userId, params.fileName, params.xmlContent, params.encoded);
        break;

      case 'getXMLFiles':
        result = getUserXMLFiles(params.userId);
        break;

      case 'getXMLContent':
        result = getXMLContent(params.fileId, params.userId);
        break;

      case 'deleteXML':
        result = deleteXMLFile(params.fileId, params.userId);
        break;

      case 'renameXML':
        result = renameXMLFile(params.fileId, params.userId, params.newName);
        break;

      case 'changePassword':
        result = changePassword(params.userId, params.oldPassword, params.newPassword);
        break;

      case 'changeUsername':
        result = changeUsername(params.userId, params.newUsername, params.password);
        break;

      case 'deleteAccount':
        result = deleteAccount(params.userId, params.password);
        break;

      default:
        result = { success: false, message: 'Unknown action: ' + action };
    }

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
