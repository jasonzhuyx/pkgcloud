/*
* authentication-test.js: Tests for pkgcloud Rackspace compute authentication
*
* (C) 2010 Nodejitsu Inc.
*
*/

var should = require('should'),
    async = require('async'),
    hock = require('hock'),
    macros = require('../macros'),
    helpers = require('../../helpers'),
    mock = !!process.env.MOCK;

describe('pkgcloud/rackspace/compute/authentication', function () {
  var client, authServer, server;

  describe('The pkgcloud Rackspace Compute client', function () {

    before(function (done) {
      client = helpers.createClient('rackspace', 'compute');

      if (!mock) {
        return done();
      }

      async.parallel([
        function (next) {
          hock.createHock(12346, function (err, hockClient) {
            should.not.exist(err);
            should.exist(hockClient);

            authServer = hockClient;
            next();
          });
        },
        function (next) {
          hock.createHock(12345, function (err, hockClient) {
            should.not.exist(err);
            should.exist(hockClient);

            server = hockClient;
            next();
          });
        }
      ], done);
    });

    it('should have core methods defined', function() {
      macros.shouldHaveCreds(client);
    });

    it('the getVersion() method should return the proper version', function (done) {
      if (mock) {
        authServer
          .post('/v2.0/tokens', {
            auth: {
              'RAX-KSKEY:apiKeyCredentials': {
                username: 'MOCK-USERNAME',
                apiKey: 'MOCK-API-KEY'
              }
            }
          })
          .reply(200, helpers.getRackspaceAuthResponse());

        server
          .get('/v2/')
          .replyWithFile(200, __dirname + '/../../fixtures/rackspace/versions.json');
      }

      client.getVersion(function (err, version) {
        should.not.exist(err);
        should.exist(version);
        version.should.equal('v2');
        server && server.done();
        authServer && authServer.done();
        done();
      });
    });



    describe('the auth() method with a valid username and api key', function () {
      var err, res;

      beforeEach(function (done) {

        client = helpers.createClient('rackspace', 'compute');

        if (mock) {
          authServer
            .post('/v2.0/tokens', {
              auth: {
                'RAX-KSKEY:apiKeyCredentials': {
                  username: 'MOCK-USERNAME',
                  apiKey: 'MOCK-API-KEY'
                }
              }
            })
            .reply(200, helpers.getRackspaceAuthResponse());
        }

        client.auth(function (e) {
          should.not.exist(e);
          authServer && authServer.done();
          done();
        });
      });

      it('should update the config with appropriate urls', function () {
        client._identity.should.be.a('object');
      });

      it('the getLimits() method should return the proper limits', function (done) {
        if (mock) {
          server
            .get('/v2/123456/limits')
            .reply(200, { limits: { absolute: { maxPrivateIPs: 0 }, rate: [] } }, {});
        }

        client.getLimits(function (err, limits) {
          should.not.exist(err);
          should.exist(limits);
          should.exist(limits.absolute);
          should.exist(limits.rate);
          limits.rate.should.be.instanceOf(Array);
          server && server.done();
          done();
        });
      });
    });

    describe('the auth() method with an invalid username and api key', function () {

      var badClient = helpers.createClient('rackspace', 'compute', {
        username: 'fake',
        apiKey: 'data',
        authUrl: 'localhost:12346',
        protocol: 'http://'
      });

      var err, res;

      beforeEach(function (done) {

        if (mock) {
          authServer
            .post('/v2.0/tokens', {
              auth: {
                'RAX-KSKEY:apiKeyCredentials': {
                  username: 'fake',
                  apiKey: 'data'
                }
              }
            })
            .reply(401, {
              unauthorized: {
                message: 'Username or api key is invalid', code: 401
              }
            });
        }

        badClient.auth(function (e) {
          err = e;
          authServer && authServer.done();
          done();
        });

      });

      it('should respond with Error code 401', function () {
        should.exist(err);
        // TODO resolve identity responses
      });
    });

    describe('auth tokens should expire', function () {
      var tokenExpiry;

      beforeEach(function (done) {

        client = helpers.createClient('rackspace', 'compute');

        client.on('log::*', function(message, obj) {
          if (this.event !== 'log::debug') {
            console.log(message);
            console.dir(obj);
          }
        });

        if (mock) {

          var response = helpers.getRackspaceAuthResponse(new Date(new Date().getTime() + 1));

          tokenExpiry = response.access.token.expires;

          authServer
            .post('/v2.0/tokens', {
              auth: {
                'RAX-KSKEY:apiKeyCredentials': {
                  username: 'MOCK-USERNAME',
                  apiKey: 'MOCK-API-KEY'
                }
              }
            })
            .reply(200, response);
        }

        client.auth(function (e) {
          should.not.exist(e);
          authServer && authServer.done();
          done();
        });
      });

      it('should update the config with appropriate urls', function () {
        client._identity.should.be.a('object');
        client._identity.token.expires.toString().should.equal(tokenExpiry);
      });

      it('should expire the token and set authorized to false', function(done) {
        setTimeout(function() {
          client._isAuthorized().should.equal(false);
          done();
        }, 5);
      });

      it('should expire the token and reauth on next call', function (done) {

        if (mock) {
          authServer
            .post('/v2.0/tokens', {
              auth: {
                'RAX-KSKEY:apiKeyCredentials': {
                  username: 'MOCK-USERNAME',
                  apiKey: 'MOCK-API-KEY'
                }
              }
            })
            .reply(200, helpers.getRackspaceAuthResponse());

          server
            .get('/v2/123456/images/detail')
            .replyWithFile(200, __dirname + '/../../fixtures/rackspace/images.json');
        }

        setTimeout(function () {
          client._isAuthorized().should.equal(false);
          client.getImages(function(err, images) {
            client._isAuthorized().should.equal(true);
            should.not.exist(err);
            should.exist(images);
            server && server.done();
            authServer && authServer.done();
            done();
          });
        }, 5);
      });
    });

    after(function (done) {
      if (!mock) {
        return done();
      }

      async.parallel([
        function (next) {
          authServer.close(next);
        },
        function (next) {
          server.close(next);
        }
      ], done)
    });
  });
});
