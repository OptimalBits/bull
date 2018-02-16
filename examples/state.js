/**
  State machine.

  Distributed state machine.
  */

var machine = Machine('signup', opts); // opts -> redis connection mostly, name of the machine.

machine.state('send mail', function(data, next) {
  // In this state we send an email with a confirmation link and exit the state
  next('wait confirmation', data);
});

machine.state('wait confirmation'); // // In this state we do nothing we just wait for an external input

machine.state('confirm user', function(task) {
  return data;
});

machine.next('wait confirmation', data);

/**
  queue('wait confirmation').add(data);
  */
machine
  .state('transcode video', function(data) {
    // transcode...
    this.next('append moov');
  })
  .catch(function(err) {
    this.next('delete tmp');
  });

machine.state('append moov', input, function(data, next) {
  // Append MOOV etc.
  this.next('delete tmp');
});

machine.next('delete temp', input, function(data, next) {
  // delete temp file
  this.next('update user account');
});

machine.state('update user account', function(data, next) {
  // update database
});
