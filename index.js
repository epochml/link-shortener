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
  
  const response = await fetch('https://webauth.epochml.org/auth/realms/epochml.org/protocol/openid-connect/userinfo', {
    method: 'GET',
    headers: myHeaders,
  }).catch(error => {console.error(error);});
  if (response.status === 200) {
    return response.json();
  } else {
    throw new Error('Something went wrong on api server!');
  }
}

app.use(keycloak.middleware());
app.get('/', keycloak.protect(), async function (req, res) {
  let email;
  let name;
  try {
    const bearer_token = JSON.parse(req.session['keycloak-token']).access_token;
    let userInfo = await getUserInfo(bearer_token);
    email = userInfo.email;
    name = userInfo.name
  } catch (e) {
    res.json({
      message: "Could not get user authorization information.",
      error: e
    })
    return
  }
  res.render('index.html', {email, name})
  return
})

app.post('/addURL', keycloak.protect(), async function (req, res) {
  let email;
  try {
    const bearer_token = JSON.parse(req.session['keycloak-token']).access_token;
    let userInfo = await getUserInfo(bearer_token);
    email = userInfo.email;
  } catch (e) {
    res.status(500).json({
      message: "Could not get user authorization information.",
      error: e
    })
    return
  }
  const db = await csvdb("links.csv", ["url", "name", "email"]).catch((e) => {
    console.error(e)
    res.status(500).json({
      message: "Error getting information from DB"
    })
    return
  });
  const url = req.query.url;
  const name = req.query.name; 
  if (url === undefined || name === undefined) {
    res.status(400).json({
      message: "Either url or name was not provided."
    })  
    return
  }
  let old;
  try {
    old = await db.get({name});
  } catch {
    res.status(500).json({
      message: "Error getting information from DB"
    })
    return
  }
  
  if (old.length > 0) {
    res.status(400).json({
      message: "This short URL has already been taken. Please try another."
    });
  } else {
    await db.add({url, name, email});
    res.json({
      url: req.query.url,
      shortURL: `https://out.epochml.org/${req.query.name}`,
      email
    });
    return
  }

});

app.get('/getUserURLs', keycloak.protect(), async function (req, res) {
  let email;
  try {
    const bearer_token = JSON.parse(req.session['keycloak-token']).access_token;
    let userInfo = await getUserInfo(bearer_token);
    email = userInfo.email;
  } catch (e) {
    res.json({
      message: "Could not get user authorization information.",
      error: e
    })
  }
  const db = await csvdb("links.csv", ["url", "name", "email"]).catch((e) => {
    console.error(e)
    res.status(500).json({
      message: "Error getting information from DB"
    })
    return
  });
  const all = await db.get({email});
  res.json(all)
})

app.get('/:id', async function(req,res) {
  const name = req.params.id;
  const db = await csvdb("links.csv", ["url", "name", "email"]);
  const url = await db.get({name});
  console.log(url)
  try {
    if (url.length < 1) {
      res.status(404).render('404.html')
    } else {
      res.redirect(url[0].url);
    }
  } catch {
    res.json({
      message: "Unforunately, we were unable to redirect you. Please try again."
    })
  }
  
})