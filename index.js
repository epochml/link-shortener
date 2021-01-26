const Keycloak = require('keycloak-connect');
const hogan = require('hogan-express');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const fetch = require('node-fetch');
const baseURL = process.env.baseURL || 'out.epochml.org';
const favicon = require('serve-favicon');
const sqlite3 = require('sqlite3')
const dbVendor = process.env.DB_VENDOR;
if (dbVendor === "postgresql") {
  console.error("SQL support not yet implemented")
  process.exit(2)
} else {
  var db = new sqlite3.Database(process.env.DB_FILE, sqlite3.OPEN_READWRITE, (err) => {
    if (err) {
      console.error(err.message);
      process.exit(1);
    }
  })
  var store = new SQLiteStore({'dir': process.env.SESSION_DB_FILE_LOC, 'db': process.env.SESSION_DB_FILE_NAME});
}

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

app.use(session({
  secret: 'mySecret',
  resave: false,
  saveUninitialized: true,
  store: store
}));

var keycloak = new Keycloak({
  store: store
});

app.use(favicon(__dirname + '/public/img/favicon.ico'));
app.use('/static', express.static('public'))



async function getUserInfo(bearer_token) {
  const myHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${bearer_token}`
  };

  const response = await fetch('https://webauth.epochml.org/auth/realms/epochml.org/protocol/openid-connect/userinfo', {
    method: 'GET',
    headers: myHeaders,
  }).catch(error => { console.error(error); });
  if (response.status === 200) {
    return response.json();
  } else {
    throw new Error('Something went wrong on api server!');
  }
}

async function addURLToDB(name, url, email) {
  return new Promise(function(resolve, reject) {
    db.serialize(function() {
      const stmt = db.prepare("INSERT INTO urlData (name, url, email) VALUES (?, ?, ?)");
      stmt.run([name, url, email], function(err) {
        if (err) {
          reject(err)
        } else {
          resolve({name, url, email})
        }
      })
    })
  })
}
async function getDataForEmail(email) {
  return new Promise(function(resolve, reject) {
    db.serialize(function() {
      const stmt = db.prepare("SELECT * FROM urlData WHERE email=?");
      stmt.all([email], function(err, data) {
        if (err) {
          reject(err)
        } else {
          resolve(data)
        }
      })
    })
  })
}
async function removeURLfromDB(name) {
  return new Promise(function(resolve, reject) {
    db.serialize(function() {
      const stmt = db.prepare("DELETE FROM urlData WHERE name=?");
      stmt.run([name], function(err) {
        if (err) {
          reject(err)
        } else {
          resolve(name)
        }
      })
    })
  })
}
async function getRedirectURL(name) {
  return new Promise(function(resolve, reject) {
    db.serialize(function() {
      const stmt = db.prepare("SELECT url FROM urlData WHERE name=?");
      stmt.all([name], function(err, data) {
        if (err) {
          reject(err)
        } else {
          resolve(data)
        }
      })
    })
  })
}
async function updateRecord(name, url) {
  return new Promise(function(resolve, reject) {
    db.serialize(function() {
      const stmt = db.prepare("UPDATE urlData SET url=?, name=? WHERE name=?");
      stmt.run([url, name, name], function(err) {
        if (err) {
          reject(err)
        } else {
          resolve({name, url})
        }
      })
    })
  })
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
    res.status(500).render('500')
    return
  }
  res.render('index.html', { email, name, baseURL })
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
  const url = req.query.url;
  const name = req.query.name;
  if (url.indexOf(baseURL) > -1 ) {
    res.json({
      message: `The origin URL cannot be a path of ${baseURL}`
    })
    return
  }
  if (url === undefined || name === undefined) {
    res.status(400).json({
      message: "Either url or name was not provided."
    })
    return
  }
  addURLToDB(name, url, email).then((obj) => {
    res.json({
      url: obj.url,
      shortURL: `https://out.epochml.org/${obj.name}`,
      email: obj.email
    });
  }).catch((err) => {
    if (err.errno == 19) {
      res.status(409).json({
        message: "This short URL has already been taken. Please try another."
      })
    } else {
      res.status(500).json({
        message: "The short URL could not be added. Please try again."
      })
    }

  })
  return

});

app.get('/mylinks', keycloak.protect(), async function (req, res) {
  let email;
  let name;
  try {
    const bearer_token = JSON.parse(req.session['keycloak-token']).access_token;
    let userInfo = await getUserInfo(bearer_token);
    email = userInfo.email;
    name = userInfo.name
  } catch (e) {
    res.status(500).render('500')
  }
  const data = await getDataForEmail(email).catch(() => {res.status(500).render('500'); return});
  res.render('mylinks', {
    data,
    name,
    email,
    baseURL
  })
})

app.delete('/deleteLink', keycloak.protect(), async function (req, res) {
  const name = req.query.name;
  removeURLfromDB(name).then(() => {
    res.json({
      name, deleted: true
    })
    return
  }).catch(() => {
    res.status(500).json({
      message: "Could not delete the link. Please try again."
    })
    return
  })
})
app.put('/updateLink', keycloak.protect(), async function (req, res) {
  const name = req.query.name;
  const url = req.query.url;
  if (url.indexOf(baseURL) > -1 ) {
    res.json({
      message: `The origin URL cannot be a path of ${baseURL}`
    })
    return
  }
  updateRecord(name, url).then((data) => {
    res.json(data);
    return;
  }).catch(() => {
    res.status(500).json({
      message: "Could not update the link. Please try again."
    })
    return
  })
})

app.get('/:id', async function (req, res) {
  const name = req.params.id;
  const ts = Date.now();
  try {
    const url = await getRedirectURL(name)
    if (url[0] !== undefined) {
      res.redirect(url[0].url)
      return
    } else {
      res.status(404).render('404')
      return
    }
  } catch {
    res.status(500).render('500')
    return
  }

})