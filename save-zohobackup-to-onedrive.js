//-----------------------CONFIG AND IMPORT... CONFIG AND IMPORT...---------------------------
'use strict';
//get os for discovering tmp directory
const fs = require('fs');
const path = require('path');
const os = require('os');
//dotenv for environment variables
const dotenv = require('dotenv').config();
//axios for API calls
const axios = require('axios');
//
//-----------------APP CONSTANTS...APP CONTSANTS... APP CONSTANTS---------------------------
//access token URL, be very careful here and check ./.env for environment variables
const accessTokenURL = `https://accounts.zoho.com/oauth/v2/token?refresh_token=${process.env.REFRESH_TOKEN}&client_id=${process.env.CLIENT_ID}&client_secret=${process.env.CLIENT_SECRET}&grant_type=refresh_token`;
const microsoftAuthUrl = `https://login.microsoftonline.com/${process.env.MICROSOFT_DIRECTORYID}/oauth2/v2.0/token`;
//
//-------------------------FUNCTIONS...FUNCTIONS...FUNCTIONS---------------------------------
//
//get the filename
function getLastPathSegment(urlString) {
  // Find the last occurrence of "/"
  const lastSlashIndex = urlString.lastIndexOf('/');
  
  // If no slash is found, return the original string
  if (lastSlashIndex === -1) {
    return urlString;
  }
  
  // Extract everything to the right of the last slash
  return urlString.substring(lastSlashIndex + 1);
}
//create a backup folder "name"
function createBackupFolderName(){
    // Create the date string directly using toISOString()
    const timestamp = Date.now();
    const date = new Date(timestamp);
    // toISOString() returns a string like "2025-04-26T12:34:56.789Z"
    // We just need the date part (first 10 characters)
    const dateString = date.toISOString().slice(0, 10);
    return `zCRMAutoBackup-${dateString}`;
}
//get a Microsoft token
async function getMicrosoftToken() {
    return new Promise((resolve, reject) => {
        try{
            const microsoftHeaders = {
              client_id: process.env.MICROSOFT_CLIENTID,
              client_secret: process.env.MICROSOFT_SECRET_VALUE,
              grant_type: 'client_credentials',
              scope: 'https://graph.microsoft.com/.default'
            };
            // Get the access token first
            axios({
              url: microsoftAuthUrl,
              method: 'POST',
              data: microsoftHeaders,
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
              }
            })
            .then((micAuthResponse) => {
                const microsoftAccessToken = micAuthResponse.data.access_token;
                resolve(microsoftAccessToken)
            })

            
        }
        catch(err){
            reject('error with token')
        }
    })
}
//get a Zoho auth token
async function getZohoToken() {
    return new Promise((resolve, reject) => {
        try{
             axios.post(accessTokenURL, {headers: {'Content-Type' : 'application/json' }})
                .then(postResponse => {
                        //console.log(postResponse);
                        const accessToken = postResponse.data.access_token;
                        resolve(accessToken);
                })
        }
        catch(err){
            reject(err);
        }
    })
}
//download a file to local tmp directory
async function downloadFile(url) {
    try {
        const zohoToken = await getZohoToken();
        const downloadHeaders = {'Content-Type' : 'application/json' , 'Authorization' : `Zoho-oauthtoken ${zohoToken}`};
        const filename = getLastPathSegment(url);
        // Create a path in the temporary directory
        //'/Users/whiteside/Documents/crm-backup/files'
        const tempFilePath = path.join(os.tmpdir(), filename);
        console.log('starting download to ' + tempFilePath);
        console.log('auth headers ');
        console.log(downloadHeaders);
        // Make the GET request with responseType 'stream'
        const response = await axios({
            method: 'GET',
            url: url,
            headers: downloadHeaders,
            responseType: 'stream'
        });

        // Create a write stream and pipe the response data to it
        const writer = fs.createWriteStream(tempFilePath);
        response.data.pipe(writer);

        // Return a promise that resolves when the download is complete
        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                console.log(`File downloaded successfully to: ${tempFilePath}`);
                resolve(tempFilePath);
            });
            writer.on('error', (err) => {
                console.error('Error writing file:', err);
                reject(err);
            });
        });
    } 
    catch (error) {
        console.error('Error downloading file:', error);
        throw error;
    }
}
//Upload files to OneDrive
async function uploadLargeFile(filePath, microsoftToken, folderId) {
    const fileName = getLastPathSegment(filePath);
  try {
      console.log('starting upload process for ' + fileName)
    const accessToken = microsoftToken;
    const fileSize = fs.statSync(filePath).size;
    
    // Create upload session
    const sessionUrl = `https://graph.microsoft.com/v1.0/drives/${process.env.MICROSOFT_DRIVEID}/items/${folderId}:/${fileName}:/createUploadSession`;
    const sessionResponse = await axios.post(sessionUrl, {}, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      }
    });
    
    const uploadUrl = sessionResponse.data.uploadUrl;
    const chunkSize = 327680; // 320 KB
    console.log('got upload url: ' + uploadUrl);
      console.log('starting upload... this could take a while...');
    // Read and upload file in chunks
    const fileBuffer = fs.readFileSync(filePath);
    
    for (let i = 0; i < fileSize; i += chunkSize) {
      const chunkEnd = Math.min(i + chunkSize - 1, fileSize - 1);
      const chunkData = fileBuffer.slice(i, chunkEnd + 1);
      if((i/chunkSize) % 10 == 0){
          console.log(`Uploading ${fileName} - bytes ${i}-${chunkEnd}/${fileSize} - ${i/fileSize*100}%`)
      }
      try {
        await axios.put(uploadUrl, chunkData, {
          headers: {
            'Content-Length': `${chunkData.length}`,
            'Content-Range': `bytes ${i}-${chunkEnd}/${fileSize}`
          }
        });
      } catch (error) {
        console.error('Chunk upload error:', error.response?.data || error.message);
        throw error;
      }
    }
    
    console.log('Large file upload completed: ' + fileName);
    return { success: true, fileName };
  } 
    catch (error) {
    console.error('Error in large file upload:', error.response?.data || error.message);
    throw error;
  }
}
//main iterator for files
async function downloadFiles(urlArray, folderId) {
    let filePathList = [];
    for (const url of urlArray) {
        try {
            const filePath = await downloadFile(url);
            filePathList.push(filePath);
            const microsoftToken = await getMicrosoftToken();
            console.log(microsoftToken);
            const uploadFile = await uploadLargeFile(filePath, microsoftToken, folderId)
        } catch (error) {
          console.error(`Error downloading ${url}:`, error);
        }
      }
    console.log('Batch completed');
    return filePathList;
}
//
//
//-----------------------------------MAIN FUNCTION--------------------------------------------
//get Zoho autho token
axios.post(accessTokenURL, {headers: {'Content-Type' : 'application/json' }})
.then((postResponse) => {
    //console.log(postResponse);
    const accessToken = postResponse.data.access_token;
    const authHeader = `Zoho-oauthtoken ${accessToken}`;
    console.log('first header' + authHeader);
    //now you have access token
    //get microsoft credentials
    const microsoftHeaders = {
        client_id:process.env.MICROSOFT_CLIENTID,
        client_secret:process.env.MICROSOFT_SECRET_VALUE,
        grant_type:'client_credentials',
        scope:'https://graph.microsoft.com/.default'
    };
    axios({
        url:microsoftAuthUrl,
        method:'POST',
        data:microsoftHeaders,
        scope:'Files.ReadWrite.All',
        headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
        }
    })
    .then((microsoftAuthResponse) => {
        const microsoft_token = microsoftAuthResponse.data.access_token;
        console.log(microsoft_token);
        //console.log(microsoftAuthResponse);
        //now that you have zoho auth and microsoft auth
        //Backup Request API URL
        const getUrl = 'https://www.zohoapis.com/crm/bulk/v7/backup/urls';
        //get backup URLs
        axios.get(getUrl, {headers: {'Content-Type' : 'application/json' , 'Authorization' : authHeader}})
        .then((getResponse) => {
            //console.log(getResponse);
            ////set a folderName first 
            // Format as yyyy-mm-dd
            const folderName = createBackupFolderName();
            //POST - create new folder
            axios({
                url: `https://graph.microsoft.com/v1.0/drives/${process.env.MICROSOFT_DRIVEID}/items/${process.env.MICROSOFT_FOLDERID}/children`,
                method : 'POST',
                headers: {
                    Authorization : `Bearer ${microsoft_token}`,
                    "Content-Type" : 'application/json'
                },
                data : {
                    name : folderName,
                    folder: {},
                    "@microsoft.graph.conflictBehavior" : 'rename'
                }
            })
            .then(createFolderResponse => {
                //Now you have created a new folder for these backup files
                //console.log(createFolderResponse)
                const newFolderId = createFolderResponse.data.id;
                console.log('new folder ID: '  + newFolderId);
                try{
                    const responseData = getResponse.data.urls;
                    //console.log(responseData);
                    //do data link here
                    const dataLinks = responseData.data_links;
                    console.log(dataLinks);
                    downloadFiles(dataLinks, newFolderId)
                    .then((filePathArray) => {
                        console.log(filePathArray);
                    })
                    .catch(err => console.log(err));
        
                    //do attachment links here
                    const attachmentLinks = responseData.attachment_links;
                    downloadFiles(attachmentLinks, newFolderId)
                    .then((filePathArray) => {
                        console.log(filePathArray);
                    })
                    .catch(err => console.log(err));
                }
                catch(err){}

            })
            .catch(err => console.log(err.response.data));
        })
    })
    .catch(err => console.log(err));
})
.catch(err => console.log(err));
//-------------------------------END OF MAIN FUNCTION-----------------------------------------
//
//
//
//
//Extra code generated that may be helpful to get OneDrive info
//
async function listOneDriveFolders() {
  try {
      getMicrosoftToken()
      .then(microsoftToken => {
          //console.log(microsoftToken);
          //find out about OneDrive users
          axios({
              url: 'https://graph.microsoft.com/v1.0/users/zoho@brkthru.com',
              method: 'GET',
              headers: {
                Authorization: `Bearer ${microsoftToken}`
              }
          })
          .then(userResponse => {
              const userId = userResponse.data.id;
              //console.log(userResponse);
              console.log('userId: ' + userId);
              //now try to get a user's oneDrive
              axios({
                  url: `https://graph.microsoft.com/v1.0/users/${userId}/drive`,
                  method: 'GET',
                  headers: {
                    Authorization: `Bearer ${microsoftToken}`
                  }
              })
              .then(driveResponse => {
                  //now you have the oneDrive info
                  //console.log(driveResponse)
                  const driveId = driveResponse.data.id;
                  console.log('driveId: ' + driveId)
                  axios({
                      url: `https://graph.microsoft.com/v1.0/drives/${driveId}/items/root/children`,
                      method: 'GET',
                      headers: {
                        Authorization: `Bearer ${microsoftToken}`
                      }
                  })
                  .then(childrenResponse => {
                      console.log(childrenResponse.data.value);
                  })
                  .catch(err => console.log(err))
              })
              .catch(err => console.log(err))
          })
          .catch(err => console.log(err))
      });
  } catch (error) {
    console.error('Error listing folders:', error.response?.data || error.message);
    throw error;
  }
}
//-------------------------------------END OF FILE-----------------------------------------------
