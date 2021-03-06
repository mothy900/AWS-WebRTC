// Copyright 2019-2020 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

const AWS = require('aws-sdk');
const compression = require('compression');
const fs = require('fs');
const http = require('http');
const url = require('url');
const { v4: uuidv4 } = require('uuid');
const ip = require("ip");

const express = require('express');
const app = express();

// Store created meetings in a map so attendees can join by meeting title
const meetingTable = {};

// Use local host for application server
const port = '3330';

// Load the contents of the web application to be used as the index page

app.use(express.static('pulbic'));
const indexPage = fs.readFileSync(`dist/${process.env.npm_config_app || 'meetingV2'}.html`);

// AWS SDK Chime 객체를 생성합니다. 현재 'us-east-1'지역이 필요합니다.
// CreateMeeting에서 아래 MediaRegion 속성을 사용하여 지역을 선택합니다.
// 회의가 주최됩니다.
const chime = new AWS.Chime({ region: 'us-east-1' });

// Set the AWS SDK Chime endpoint. The global endpoint is https://service.chime.aws.amazon.com.
chime.endpoint = new AWS.Endpoint(process.env.ENDPOINT || 'https://service.chime.aws.amazon.com');

// Start an HTTP server to serve the index page and handle meeting actions
http.createServer({}, async (request, response) => {

  log(`${request.method} ${request.url} BEGIN`);
  try {
    // Enable HTTP compression
    compression({})(request, response, () => {});
    const requestUrl = url.parse(request.url, true);
    if (request.method === 'GET' && requestUrl.pathname === '/') {
      // Return the contents of the index page
      respond(response, 200, 'text/html', indexPage);
    } else if (process.env.DEBUG && request.method === 'POST' && requestUrl.pathname === '/join') {
      // For internal debugging - ignore this.
      respond(response, 201, 'application/json', JSON.stringify(require('./debug.js').debug(requestUrl.query), null, 2));
    } else if (request.method === 'POST' && requestUrl.pathname === '/join') {
      if (!requestUrl.query.title || !requestUrl.query.name || !requestUrl.query.region) {
        throw new Error('Need parameters: title, name, region');
      }

      // Look up the meeting by its title. If it does not exist, create the meeting.
      if (!meetingTable[requestUrl.query.title]) {
        meetingTable[requestUrl.query.title] = await chime.createMeeting({
          // Use a UUID for the client request token to ensure that any request retries
          // do not create multiple meetings.
          ClientRequestToken: uuidv4(),
          // Specify the media region (where the meeting is hosted).
          // In this case, we use the region selected by the user.
          MediaRegion: requestUrl.query.region,
          // Any meeting ID you wish to associate with the meeting.
          // For simplicity here, we use the meeting title.
          ExternalMeetingId: requestUrl.query.title.substring(0, 64),
        }).promise();
      }

      // Fetch the meeting info
      const meeting = meetingTable[requestUrl.query.title];

      // Create new attendee for the meeting
      const attendee = await chime.createAttendee({
        // The meeting ID of the created meeting to add the attendee to
        MeetingId: meeting.Meeting.MeetingId,

        // Any user ID you wish to associate with the attendeee.
        // For simplicity here, we use a random id for uniqueness
        // combined with the name the user provided, which can later
        // be used to help build the roster.
        ExternalUserId: `${uuidv4().substring(0, 8)}#${requestUrl.query.name}`.substring(0, 64),
      }).promise()

      // Return the meeting and attendee responses. The client will use these
      // to join the meeting.
      respond(response, 201, 'application/json', JSON.stringify({
        JoinInfo: {
          Meeting: meeting,
          Attendee: attendee,
        },
      }, null, 2));
    } else if (request.method === 'POST' && requestUrl.pathname === '/end') {
      // End the meeting. All attendee connections will hang up.
      await chime.deleteMeeting({
        MeetingId: meetingTable[requestUrl.query.title].Meeting.MeetingId,
      }).promise();
      respond(response, 200, 'application/json', JSON.stringify({}));
    } else {
      respond(response, 404, 'text/html', '404 Not Found');
    }
  } catch (err) {
    respond(response, 400, 'application/json', JSON.stringify({ error: err.message }, null, 2));
  }
  log(`${request.method} ${request.url} END`);
}).listen(port/*.split(':')[1], host.split(':')[0]//*/, () => {
  // console.log(port);
  log('server running at http://'+ip.address()+`:${port}/`);
});

function log(message) {
  console.log(`${new Date().toISOString()} ${message}`);
};

function respond(response, statusCode, contentType, body) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', contentType);
  response.end(body);
  if (contentType === 'application/json') {
    log(body);
  }
}
