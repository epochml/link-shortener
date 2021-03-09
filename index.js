const hogan = require('hogan-express');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const baseURL = process.env.baseURL || 'out.epochml.org';
const favicon = require('serve-favicon');
const sqlite3 = require('sqlite3')
const dbVendor = process.env.DB_VENDOR;
const config = require('./config');
const passport = require('passport')
var OIDCStrategy = require('passport-azure-ad').OIDCStrategy;
var cookieParser = require('cookie-parser');

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
//-----------------------------------------------------------------------------
// To support persistent login sessions, Passport needs to be able to
// serialize users into and deserialize users out of the session.  Typically,
// this will be as simple as storing the user ID when serializing, and finding
// the user by ID when deserializing.
//-----------------------------------------------------------------------------
passport.serializeUser(function(user, done) {
  done(null, user.oid);
});

passport.deserializeUser(function(oid, done) {
  findByOid(oid, function (err, user) {
    done(err, user);
  });
});

// array to hold logged in users
var users = [];

var findByOid = function(oid, fn) {
  for (var i = 0, len = users.length; i < len; i++) {
    var user = users[i];
    if (user.oid === oid) {
      return fn(null, user);
    }
  }
  return fn(null, null);
};

passport.use(new OIDCStrategy({
  identityMetadata: config.creds.identityMetadata,
  clientID: config.creds.clientID,
  responseType: config.creds.responseType,
  responseMode: config.creds.responseMode,
  redirectUrl: config.creds.redirectUrl,
  allowHttpForRedirectUrl: config.creds.allowHttpForRedirectUrl,
  clientSecret: config.creds.CLIENT_SECRET,
  validateIssuer: config.creds.validateIssuer,
  isB2C: config.creds.isB2C,
  issuer: config.creds.issuer,
  passReqToCallback: config.creds.passReqToCallback,
  scope: config.creds.scope,
  loggingLevel: config.creds.loggingLevel,
  nonceLifetime: config.creds.nonceLifetime,
  nonceMaxAmount: config.creds.nonceMaxAmount,
  useCookieInsteadOfSession: config.creds.useCookieInsteadOfSession,
  cookieEncryptionKeys: config.creds.cookieEncryptionKeys,
  clockSkew: config.creds.clockSkew,
},
function(iss, sub, profile, accessToken, refreshToken, done) {
  if (!profile.oid) {
    return done(new Error("No oid found"), null);
  }
  // asynchronous verification, for effect...
  process.nextTick(function () {
    findByOid(profile.oid, function(err, user) {
      if (err) {
        return done(err);
      }
      if (!user) {
        // "Auto-registration"
        users.push(profile);
        return done(null, profile);
      }
      return done(null, user);
    });
  });
}
));
app.use(cookieParser());
app.use(express.urlencoded({ extended : true }));
app.use(passport.initialize());
app.use(passport.session());
app.use(favicon(__dirname + '/public/img/favicon.ico'));
app.use('/static', express.static('public'))
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) { return next(); }
  res.redirect('/login');
};

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

app.get('/login',
  function(req, res, next) {
    passport.authenticate('azuread-openidconnect', 
      { 
        response: res,                      // required
        resourceURL: config.resourceURL,    // optional. Provide a value if you want to specify the resource.
        customState: 'my_state',            // optional. Provide a value if you want to provide custom state value.
        failureRedirect: '/' 
      }
    )(req, res, next);
  },
  function(req, res) {
    res.redirect('/');
});

// 'GET returnURL'
// `passport.authenticate` will try to authenticate the content returned in
// query (such as authorization code). If authentication fails, user will be
// redirected to '/' (home page); otherwise, it passes to the next middleware.
app.get('/auth/openid/return',
  function(req, res, next) {
    passport.authenticate('azuread-openidconnect', 
      { 
        response: res,    // required
        failureRedirect: '/'  
      }
    )(req, res, next);
  },
  function(req, res) {
    res.redirect('/');
  });

// 'POST returnURL'
// `passport.authenticate` will try to authenticate the content returned in
// body (such as authorization code). If authentication fails, user will be
// redirected to '/' (home page); otherwise, it passes to the next middleware.
app.post('/auth/openid/return',
  function(req, res, next) {
    passport.authenticate('azuread-openidconnect', 
      { 
        response: res,    // required
        failureRedirect: '/'  
      }
    )(req, res, next);
  },
  function(req, res) {
    res.redirect('/');
  });

// 'logout' route, logout from passport, and destroy the session with AAD.
app.get('/logout', function(req, res){
  req.session.destroy(function(err) {
    req.logOut();
    res.redirect(config.destroySessionUrl);
  });
});

// begin business logic

app.get('/', ensureAuthenticated, async function (req, res) {

  res.render('index.html', { email: req.user._json.preferred_username, name: req.user.displayName, baseURL })
  return
})

app.post('/addURL', ensureAuthenticated, async function (req, res) {
  const email = req.user._json.preferred_username;
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

app.get('/mylinks', ensureAuthenticated, async function (req, res) {
  const email = req.user._json.preferred_username;
  const name = req.user.displayName;
  const data = await getDataForEmail(email).catch(() => {res.status(500).render('500'); return});
  res.render('mylinks', {
    data,
    name,
    email,
    baseURL
  })
})

app.delete('/deleteLink', ensureAuthenticated, async function (req, res) {
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
app.put('/updateLink', ensureAuthenticated, async function (req, res) {
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