import {exec}  from 'child_process';

const createVirtualSink = () => {
    return new Promise((resolve, reject) => {
        exec (
            "pactl load-module module-null-sink sink_name=record_sink",
            (err, stdout) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(stdout.trim());
            }
        )
    })
}

const listVirtualSinks = () => {
    exec(
        "pactl list sink-inputs short",
        (err, stdout) => {
            console.log(stdout);
        }
    );
}
// createVirtualSink();
listVirtualSinks();