/*
 * Copyright 2016 Red Hat Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. You may obtain a copy of
 * the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations under
 * the License.
 */

const Keycloak = require('keycloak-connect');
const hogan = require('hogan-express');
const express = require('express');
const session = require('express-session');
const csvdb = require("csv-database");
const fetch = require('node-fetch');

var app = express();
var server = app.listen(9215, function () {
  var host = server.address().address;
  var port = server.address().port;
  console.log('Example app listening at http://%s:%s', host, port);
});

// Register '.mustache' extension with The Mustache Express
app.set('view engine', 'html');
app.set('views', require('path').join(__dirname, '/view'));
app.engine('html', hogan);

// Create a session-store to be used by both the express-session
// middleware and the keycloak middleware.

var memoryStore = new session.MemoryStore();

app.use(session({
  secret: 'mySecret',
  resave: false,
  saveUninitialized: true,
  store: memoryStore
}));

var keycloak = new Keycloak({
  store: memoryStore
});

async function getUserInfo(bearer_token) {
  const myHeaders = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${bearer_token}`
  };
  
  return fetch('https://webauth.epochml.org/auth/realms/epochml.org/protocol/openid-connect/userinfo', {
    method: 'GET',
    headers: myHeaders,
  })
  .then(response => {
      if (response.status === 200) {
        return response.json();
      } else {
        throw new Error('Something went wrong on api server!');
      }
    })
    .then(response => {
      console.debug(response);
    }).catch(error => {
      console.error(error);
    });
}

app.use(keycloak.middleware());
app.get('/:id', async function(req,res) {
  const name = req.params.id;
  const db = await csvdb("links.csv", ["name","url", "user"]);
  const url = await db.get({name});
  res.redirect(url[0].url);
})
app.get('/', keycloak.protect(), async function (req, res) {
  let email;
  try {
    const bearer_token = JSON.parse(req.session['keycloak-token']).access_token;
    const userInfo = await getUserInfo(bearer_token);
    email = userInfo.email;
  } catch (e) {
    res.json({
      message: "Could not get user authorization information.",
      error: e
    })
  }
  const db = await csvdb("links.csv", ["name","url", "user"]);
  const url = req.query.url;
  const name = req.query.name; 
  const old = await db.get({name});
  if (old.length > 0) {
    res.json({
      message: "This short URL has already been taken. Please try another."
    });
  } else {
    await db.add({url, name, email});
    res.json({
      url: req.query.url,
      shortURL: `https://out.epochml.org/${req.query.name}`,
      email
    });
  }

});

app.get('/getUserURLs', keycloak.protect(), async function (req, res) {
  let email;
  try {
    const bearer_token = JSON.parse(req.session['keycloak-token']).access_token;
    const userInfo = await getUserInfo(bearer_token);
    email = userInfo.email;
  } catch (e) {
    res.json({
      message: "Could not get user authorization information.",
      error: e
    })
  }
  const all = await db.get({email});
  res.json(all)
})