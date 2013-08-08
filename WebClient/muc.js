var BOSH_SERVICE = '/http-bind',
    DOMAIN = window.location.hostname;
    CONFERENCEDOMAIN = 'conference.' + DOMAIN,
    ice_config = {"iceServers": [{"url": "stun:stun.neurobot.com"}]};

    //{iceServers: [{url: 'stun:stun.l.google.com:19302'}, {url: 'turn:neurobot.com:3478'}]},
    //ice_config = {iceServers: [{url: 'stun:stun.l.google.com:19302'}]},  
    RTC = null,
    RTCPeerConnection = null,
    AUTOACCEPT = true,
    PRANSWER = false, // use either pranswer or autoaccept
    RAWLOGGING = true,
    MULTIPARTY = true,
    localStream = null,
    connection = null,
    roomjid = null,
    list_members = [];

function setStatus(txt) {
    console.log('status', txt);
    $('#status').text(txt);
}

function onConnect(status) {
    if (status == Strophe.Status.CONNECTING) {
        setStatus('Connecting.');
    } else if (status == Strophe.Status.CONNFAIL) {
        setStatus('Connecting failed.');
    } else if (status == Strophe.Status.DISCONNECTING) {
        setStatus('Disconnecting.');
    } else if (status == Strophe.Status.DISCONNECTED) {
        setStatus('Disconnected.');
        if (localStream) {
            localStream.stop();
            localStream = null;
        }
    } else if (status == Strophe.Status.CONNECTED) {
        setStatus('Connected.');

        // disco stuff
        if (connection.disco) {
            connection.disco.addIdentity('client', 'web');
            connection.disco.addFeature(Strophe.NS.DISCO_INFO);
        }
        $(document).trigger('connected');
    }
}

function onConnected(event) {
    doJoin();
    setTimeout(function() {
           $(window).bind('hashchange', onHashChange);
    }, 500);
}

function doJoin() {
    list_members = new Array();

    var iq = $iq({type: 'get'}).c('query', {xmlns: 'jabber:iq:roster'});
    connection.sendIQ(iq, roster_callback_function);
}

// This is supposed to be called on startup and give me my roster's contacts
function roster_callback_function(iq) 
{
  connection.addHandler(on_presence, null, "presence");
  connection.send($pres());

  $(iq).find('item').each(function(){
    var jid = $(this).attr('jid');
    console.log('User found: ', jid);
  });

  return true;
}

// This function will be called when the presence of a user changes
function on_presence(presence) {
  var from = $(presence).attr('from'); // the jabber_id of the contact
  var status = $(presence).find("show");

  console.log('== STATUS ==', from);

  // TODO: Now dummily connecting to user called "asmo"
  if (Strophe.getNodeFromJid(from) != Strophe.getNodeFromJid(connection.jid) && Strophe.getNodeFromJid(from) == "asmo") {
    connection.jingle.initiate(from, connection.jid);
    return false;   // means do not invoke this callback again (since we made a call)
  }
  return true;  // means the callback will be invoked again for other presences
}


function onHashChange() {
    setStatus('hashChange: ' + window.location.hash);
    if (Object.keys(connection.jingle.sessions).length == 0) {
        window.location.reload();
    }
}

function onMediaReady(event, stream) {
    localStream = stream;
    connection.jingle.localStream = stream;
    for (i = 0; i < localStream.getAudioTracks().length; i++) {
        setStatus('using audio device "' + localStream.getAudioTracks()[i].label + '"');
    }
    for (i = 0; i < localStream.getVideoTracks().length; i++) {
        setStatus('using video device "' + localStream.getVideoTracks()[i].label + '"');
    }
    // mute video on firefox and recent canary
    $('#minivideo')[0].muted = true;
    $('#minivideo')[0].volume = 0;

    RTC.attachMediaStream($('#minivideo'), localStream);

    doConnect();
}

function onMediaFailure() {
    setStatus('media failure');
}

function onCallIncoming(event, sid) {
    setStatus('incoming call' + sid);
}

function onCallActive(event, videoelem, sid) {
    setStatus('call active ' + sid);
    $(videoelem).appendTo('#largevideocontainer');
    arrangeVideos('#largevideocontainer >');
}

function onCallTerminated(event, sid, reason) {
    setStatus('call terminated ' + sid + (reason ? (': ' + reason) : ''));
    if (Object.keys(connection.jingle.sessions).length == 0) {
        setStatus('all calls terminated');
    }
    $('#largevideocontainer #largevideo_' + sid).remove();
    arrangeVideos('#largevideocontainer >');
}

function onRemoteStreamAdded(event, data, sid) {
    setStatus('Remote stream for session ' + sid + ' added.');
    if ($('#largevideo_' + sid).length != 0) {
        console.log('ignoring duplicate onRemoteStreamAdded...'); // FF 20
        return;
    }
    // after remote stream has been added, wait for ice to become connected
    // old code for compat with FF22 beta
    var el = $("<video autoplay='autoplay' style='display:none'/>").attr('id', 'largevideo_' + sid);
    RTC.attachMediaStream(el, data.stream);
    waitForRemoteVideo(el, sid);
}

function waitForRemoteVideo(selector, sid) {
    sess = connection.jingle.sessions[sid];
    videoTracks = sess.remoteStream.getVideoTracks();
    if (videoTracks.length === 0 || selector[0].currentTime > 0) {
        $(document).trigger('callactive.jingle', [selector, sid]);
        RTC.attachMediaStream(selector, sess.remoteStream); // FIXME: why do i have to do this for FF?
        console.log('waitForremotevideo', sess.peerconnection.iceConnectionState, sess.peerconnection.signalingState);
    } else {
        setTimeout(function() { waitForRemoteVideo(selector, sid); }, 100);
    }
}


function onRemoteStreamRemoved(event, data, sid) {
    setStatus('Remote stream for session ' + sid + ' removed.');
}

function onIceConnectionStateChanged(event, sid, sess) {
    console.log('ice state for', sid, sess.peerconnection.iceConnectionState);
    console.log('sig state for', sid, sess.peerconnection.signalingState);
    // works like charm, unfortunately only in chrome and FF nightly, not FF22 beta
    /*
    if (sess.peerconnection.signalingState == 'stable' && sess.peerconnection.iceConnectionState == 'connected') {
        var el = $("<video autoplay='autoplay' style='display:none'/>").attr('id', 'largevideo_' + sid);
        $(document).trigger('callactive.jingle', [el, sid]);
        RTC.attachMediaStream(el, sess.remoteStream); // moving this before the trigger doesn't work in FF?!
    }
    */
}

function arrangeVideos(selector) {
    var floor = Math.floor,
        elements = $(selector),
        howMany = elements.length,
        availableWidth = $(selector).parent().innerWidth(),
        availableHeight = $(selector).parent().innerHeight(),
        usedWidth = 0;
        aspectRatio = 4 / 3;
    if (availableHeight < availableWidth / aspectRatio) {
        availableWidth = availableHeight * aspectRatio;
    }
    elements.height(availableHeight);

    elements.each(function(index) {
        $(elements[index]).removeAttr('style');
    });

    // hardcoded layout for up to four videos
    switch (howMany) {
    case 1:
        usedWidth = availableWidth;
        $(elements[0]).css('top', 0);
        $(elements[0]).css('left', ($(selector).parent().innerWidth() - availableWidth) / 2);
        break;
    case 2:
        usedWidth = availableWidth / 2;
        $(elements[0]).css({ left: '0px', top: '0px'});
        $(elements[1]).css({ right: '0px', bottom: '0px'});
        break;
    case 3:
        usedWidth = availableWidth / 2;
        $(elements[0]).css({ left: '0px', top: '0px'});
        $(elements[1]).css({ right: '0px', top: '0px'});
        $(elements[2]).css({ left: ($(selector).parent().innerWidth() - availableWidth + usedWidth) / 2, bottom: '0px' });
        break;
    case 4:
        usedWidth = availableWidth / 2;
        $(elements[0]).css({ left: '0px', top: '0px'});
        $(elements[0]).css('left', ($(selector).parent().innerWidth() - availableWidth) / 2);
        $(elements[1]).css({ right: '0px', top: '0px'});
        $(elements[1]).css('right', ($(selector).parent().innerWidth() - availableWidth) / 2);
        $(elements[2]).css({ left: '0px', bottom: '0px'});
        $(elements[2]).css('left', ($(selector).parent().innerWidth() - availableWidth) / 2);
        $(elements[3]).css({ right: '0px', bottom: '0px'});
        $(elements[3]).css('right', ($(selector).parent().innerWidth() - availableWidth) / 2);
        break;
    }
    elements.each(function(index) {
        $(elements[index]).css({
            position: 'absolute',
            width: usedWidth,
            height: usedWidth / aspectRatio
        });
        $(elements[index]).show();
    });
}

function noStunCandidates(event) {
    setStatus('webrtc did not encounter stun candidates, NAT traversal will not work');
    console.warn('webrtc did not encounter stun candidates, NAT traversal will not work');
}

$(window).bind('beforeunload', function() {
    if (connection && connection.connected) {
        // ensure signout
        $.ajax({
                type: 'POST',
                url: '/http-bind',
                async: false,
                cache: false,
                contentType: 'application/xml',
                data: "<body rid='" + connection.rid + "' xmlns='http://jabber.org/protocol/httpbind' sid='" + connection.sid + "' type='terminate'><presence xmlns='jabber:client' type='unavailable'/></body>",
                success: function(data) {
                console.log('signed out');
                console.log(data);
            },
            error: function(XMLHttpRequest, textStatus, errorThrown) {
                console.log('signout error', textStatus + ' (' + errorThrown + ')');
            }
        });
    }
});

$(document).ready(function() {
    RTC = setupRTC();
    //connection = new Strophe.Connection(BOSH_SERVICE);
    connection = new Strophe.Connection("http://neurobot.com:5280/http-bind");
    if (RAWLOGGING) {
        connection.rawInput = function(data) { console.log('RECV: ' + data); };
        connection.rawOutput = function(data) { console.log('SEND: ' + data); };
    }
    connection.jingle.PRANSWER = PRANSWER;
    connection.jingle.AUTOACCEPT = AUTOACCEPT;
    connection.jingle.ice_config = ice_config;
    connection.jingle.MULTIPARTY = MULTIPARTY;
    connection.jingle.pc_constraints = RTC.pc_constraints;

    $(document).bind('connected', onConnected);
    $(document).bind('mediaready.jingle', onMediaReady);
    $(document).bind('mediafailure.jingle', onMediaFailure);
    $(document).bind('callincoming.jingle', onCallIncoming);
    $(document).bind('callactive.jingle', onCallActive);
    $(document).bind('callterminated.jingle', onCallTerminated);

    $(document).bind('remotestreamadded.jingle', onRemoteStreamAdded);
    $(document).bind('remotestreamremoved.jingle', onRemoteStreamRemoved);
    $(document).bind('iceconnectionstatechange.jingle', onIceConnectionStateChanged);
    $(document).bind('nostuncandidates.jingle', noStunCandidates);
    if (RTC != null) {
        RTCPeerconnection = RTC.peerconnection;
        if (RTC.browser == 'firefox') {
            connection.jingle.media_constraints.mandatory['MozDontOfferDataChannel'] = true;
        }
        //setStatus('please allow access to microphone and camera');
        //getUserMediaWithConstraints();
    } else {
        setStatus('webrtc capable browser required');
    }
});

