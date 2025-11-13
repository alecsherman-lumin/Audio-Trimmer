import React, { useState, useRef, useEffect, useCallback } from 'react';
import { PlayIcon, PauseIcon, UploadIcon, DownloadIcon, ScissorsIcon } from './components/icons';
import { formatTime, audioBufferToWavBlob } from './utils/audio';

type Clip = {
  name: string;
  blobUrl: string;
  startTime: number;
  endTime: number;
};

type DraggingState = {
  type: 'start' | 'end' | 'seek';
  initialX: number;
  initialValue: number;
} | null;

const App: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  const [selectionStart, setSelectionStart] = useState(0);
  const [selectionEnd, setSelectionEnd] = useState(0);
  
  const [clips, setClips] = useState<Clip[]>([]);
  
  const audioRef = useRef<HTMLAudioElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  
  const [dragging, setDragging] = useState<DraggingState>(null);

  useEffect(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
  }, []);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      const selectedFile = files[0];
      if (selectedFile.type.startsWith('audio/')) {
        setFile(selectedFile);
        setError(null);
        setIsLoading(true);
        
        // Reset state
        setAudioBuffer(null);
        setAudioSrc(null);
        setClips([]);
        setCurrentTime(0);
        setDuration(0);
        setIsPlaying(false);

        const reader = new FileReader();
        reader.onload = async (e) => {
          try {
            const arrayBuffer = e.target?.result as ArrayBuffer;
            if (audioContextRef.current) {
                const decodedBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);
                setAudioBuffer(decodedBuffer);
                const objectUrl = URL.createObjectURL(selectedFile);
                setAudioSrc(objectUrl);
            }
          } catch (err) {
            console.error("Error decoding audio data", err);
            setError("Could not process this audio file. Please try a different one.");
          } finally {
            setIsLoading(false);
          }
        };
        reader.onerror = () => {
          setError("Failed to read the file.");
          setIsLoading(false);
        }
        reader.readAsArrayBuffer(selectedFile);
      } else {
        setError("Please select a valid audio file.");
      }
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
      setSelectionStart(0);
      setSelectionEnd(Math.min(10, audioRef.current.duration));
    }
  };
  
  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handlePlayPause = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };
  
  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current || !audioRef.current) return;
    const timelineRect = timelineRef.current.getBoundingClientRect();
    const clickX = e.clientX - timelineRect.left;
    const percentage = clickX / timelineRect.width;
    const newTime = duration * percentage;
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>, type: 'start' | 'end' | 'seek') => {
    if (!timelineRef.current) return;
    const timelineRect = timelineRef.current.getBoundingClientRect();
    const initialX = e.clientX - timelineRect.left;
    
    let initialValue = 0;
    if (type === 'start') initialValue = selectionStart;
    else if (type === 'end') initialValue = selectionEnd;
    else if (type === 'seek') initialValue = currentTime;

    setDragging({ type, initialX, initialValue });
  };
  
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragging || !timelineRef.current || !duration) return;

    const timelineRect = timelineRef.current.getBoundingClientRect();
    const currentX = e.clientX - timelineRect.left;
    const deltaX = currentX - dragging.initialX;
    const deltaPercentage = deltaX / timelineRect.width;
    const deltaTime = deltaPercentage * duration;
    
    let newValue = dragging.initialValue + deltaTime;
    newValue = Math.max(0, Math.min(newValue, duration));
    
    if (dragging.type === 'start') {
        setSelectionStart(Math.min(newValue, selectionEnd));
    } else if (dragging.type === 'end') {
        setSelectionEnd(Math.max(newValue, selectionStart));
    } else if (dragging.type === 'seek' && audioRef.current) {
        audioRef.current.currentTime = newValue;
        setCurrentTime(newValue);
    }
  }, [dragging, duration, selectionStart, selectionEnd]);

  const handleMouseUp = useCallback(() => {
    setDragging(null);
  }, []);

  useEffect(() => {
    if (dragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    } else {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, handleMouseMove, handleMouseUp]);


  const trimAudio = async () => {
    if (!audioBuffer || !audioContextRef.current || selectionEnd <= selectionStart) return;

    const startOffset = Math.floor(selectionStart * audioBuffer.sampleRate);
    const endOffset = Math.floor(selectionEnd * audioBuffer.sampleRate);
    const frameCount = endOffset - startOffset;

    const newBuffer = audioContextRef.current.createBuffer(
      audioBuffer.numberOfChannels,
      frameCount,
      audioBuffer.sampleRate
    );

    for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
      const channelData = audioBuffer.getChannelData(i);
      const newChannelData = newBuffer.getChannelData(i);
      newChannelData.set(channelData.subarray(startOffset, endOffset));
    }
    
    const wavBlob = audioBufferToWavBlob(newBuffer);
    const blobUrl = URL.createObjectURL(wavBlob);
    
    const newClip: Clip = {
      name: `Clip ${clips.length + 1}`,
      blobUrl,
      startTime: selectionStart,
      endTime: selectionEnd,
    };
    
    setClips(prev => [...prev, newClip]);
  };
  
  return (
    <div className="min-h-screen bg-gray-900 text-gray-200 flex flex-col items-center p-4 sm:p-8 font-sans">
      <div className="w-full max-w-4xl mx-auto">
        <header className="text-center mb-8">
          <h1 className="text-4xl sm:text-5xl font-bold text-white tracking-tight">Audio Clip <span className="text-cyan-400">Trimmer</span></h1>
          <p className="text-gray-400 mt-2">Upload, select a region, and create your clips.</p>
        </header>

        <main className="bg-gray-800/50 rounded-xl shadow-2xl p-6 backdrop-blur-sm border border-gray-700">
          {!file ? (
            <FileUpload onFileChange={handleFileChange} error={error} />
          ) : isLoading ? (
            <Loader />
          ) : (
            <div>
              <p className="text-center mb-4 text-gray-400 truncate">
                <span className="font-semibold text-gray-200">File:</span> {file.name}
              </p>
              
              <AudioPlayer 
                isPlaying={isPlaying} 
                onPlayPause={handlePlayPause} 
                currentTime={currentTime} 
                duration={duration} 
              />
              
              <Timeline
                ref={timelineRef}
                currentTime={currentTime}
                duration={duration}
                selectionStart={selectionStart}
                selectionEnd={selectionEnd}
                onTimelineClick={handleTimelineClick}
                onMouseDown={handleMouseDown}
              />

              <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mt-6">
                <TimeDisplay label="Start" time={selectionStart} />
                <TimeDisplay label="End" time={selectionEnd} />
                <button
                  onClick={trimAudio}
                  disabled={selectionEnd <= selectionStart}
                  className="w-full sm:w-auto flex items-center justify-center gap-2 bg-cyan-500 hover:bg-cyan-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold py-3 px-6 rounded-lg transition-all duration-300 transform hover:scale-105 shadow-lg"
                >
                  <ScissorsIcon />
                  Create Clip
                </button>
              </div>

              {audioSrc && (
                <audio
                  ref={audioRef}
                  src={audioSrc}
                  onLoadedMetadata={handleLoadedMetadata}
                  onTimeUpdate={handleTimeUpdate}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onEnded={() => setIsPlaying(false)}
                />
              )}
            </div>
          )}

          {clips.length > 0 && <ClipList clips={clips} />}
        </main>
        
        <footer className="text-center mt-8 text-gray-500 text-sm">
          <p>Built with React, TypeScript, and Tailwind CSS.</p>
        </footer>
      </div>
    </div>
  );
};

const FileUpload = ({ onFileChange, error }: { onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void, error: string | null }) => (
  <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-gray-600 rounded-lg hover:border-cyan-400 transition-colors duration-300">
    <UploadIcon className="w-16 h-16 text-gray-500 mb-4" />
    <label htmlFor="audio-upload" className="cursor-pointer bg-gray-700 text-white font-semibold py-2 px-4 rounded-md hover:bg-gray-600 transition-colors">
      Select Audio File
    </label>
    <input id="audio-upload" type="file" accept="audio/*" className="hidden" onChange={onFileChange} />
    <p className="mt-2 text-sm text-gray-500">.mp3, .wav, .ogg, etc.</p>
    {error && <p className="mt-4 text-red-400">{error}</p>}
  </div>
);

const Loader = () => (
  <div className="flex flex-col items-center justify-center p-8">
    <div className="w-12 h-12 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin"></div>
    <p className="mt-4 text-lg text-gray-300">Processing audio...</p>
  </div>
);

const AudioPlayer = ({ isPlaying, onPlayPause, currentTime, duration }: { isPlaying: boolean, onPlayPause: () => void, currentTime: number, duration: number }) => (
  <div className="flex items-center justify-center gap-4 mb-4">
    <button onClick={onPlayPause} className="p-3 bg-cyan-500 rounded-full text-white hover:bg-cyan-600 transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-300">
      {isPlaying ? <PauseIcon /> : <PlayIcon />}
    </button>
    <div className="font-mono text-lg bg-gray-900/50 px-3 py-1 rounded-md">
      <span>{formatTime(currentTime)}</span> / <span>{formatTime(duration)}</span>
    </div>
  </div>
);

const Timeline = React.forwardRef<HTMLDivElement, {
  currentTime: number,
  duration: number,
  selectionStart: number,
  selectionEnd: number,
  onTimelineClick: (e: React.MouseEvent<HTMLDivElement>) => void,
  onMouseDown: (e: React.MouseEvent<HTMLDivElement>, type: 'start' | 'end' | 'seek') => void
}>(({ currentTime, duration, selectionStart, selectionEnd, onTimelineClick, onMouseDown }, ref) => {
  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const selectionStartPercent = duration > 0 ? (selectionStart / duration) * 100 : 0;
  const selectionWidthPercent = duration > 0 ? ((selectionEnd - selectionStart) / duration) * 100 : 0;
  // Fix: Add missing selectionEndPercent variable definition.
  const selectionEndPercent = duration > 0 ? (selectionEnd / duration) * 100 : 0;
  
  return (
    <div ref={ref} className="relative h-12 flex items-center cursor-pointer group" onClick={onTimelineClick}>
      {/* Background Track */}
      <div className="absolute top-1/2 -translate-y-1/2 left-0 w-full h-2 bg-gray-700 rounded-full"></div>

      {/* Selection Region */}
      <div 
        className="absolute top-1/2 -translate-y-1/2 h-3 bg-cyan-400/50 rounded-full"
        style={{ left: `${selectionStartPercent}%`, width: `${selectionWidthPercent}%` }}
      ></div>

      {/* Progress Bar */}
      <div 
        className="absolute top-1/2 -translate-y-1/2 left-0 h-2 bg-cyan-400 rounded-full"
        style={{ width: `${progressPercent}%` }}
      ></div>

      {/* Seek Handle */}
      <div
        className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-lg border-2 border-cyan-400 cursor-pointer"
        style={{ left: `${progressPercent}%`, transform: `translateX(-50%) translateY(-50%)` }}
        onMouseDown={(e) => { e.stopPropagation(); onMouseDown(e, 'seek') }}
      ></div>
      
      {/* Start Handle */}
      <div 
        className="absolute top-1/2 -translate-y-1/2 w-3 h-6 bg-gray-100 rounded-sm cursor-ew-resize border-2 border-cyan-500 flex items-center justify-center"
        style={{ left: `${selectionStartPercent}%`, transform: 'translateX(-50%) translateY(-50%)'}}
        onMouseDown={(e) => { e.stopPropagation(); onMouseDown(e, 'start'); }}
      >
      </div>

      {/* End Handle */}
      <div
        className="absolute top-1/2 -translate-y-1/2 w-3 h-6 bg-gray-100 rounded-sm cursor-ew-resize border-2 border-cyan-500 flex items-center justify-center"
        style={{ left: `${selectionEndPercent}%`, transform: 'translateX(-50%) translateY(-50%)' }}
        onMouseDown={(e) => { e.stopPropagation(); onMouseDown(e, 'end'); }}
      >
      </div>
    </div>
  );
});

const TimeDisplay = ({ label, time }: { label: string, time: number }) => (
  <div className="bg-gray-900/50 rounded-md p-3 w-full sm:w-auto text-center">
    <span className="text-sm text-gray-400">{label}</span>
    <p className="font-mono text-lg text-white">{formatTime(time)}</p>
  </div>
);

const ClipList = ({ clips }: { clips: Clip[] }) => (
  <div className="mt-8 pt-6 border-t border-gray-700">
    <h2 className="text-2xl font-bold mb-4 text-white">Your Clips</h2>
    <div className="space-y-3">
      {clips.map((clip, index) => (
        <div key={index} className="bg-gray-800 p-4 rounded-lg flex items-center justify-between shadow-md">
          <div>
            <p className="font-semibold text-white">{clip.name}</p>
            <p className="text-sm text-gray-400 font-mono">{formatTime(clip.startTime)} - {formatTime(clip.endTime)}</p>
          </div>
          <div className="flex items-center gap-3">
            <audio src={clip.blobUrl} controls className="h-10 custom-audio-player"></audio>
            <a
              href={clip.blobUrl}
              download={`${clip.name}.wav`}
              className="p-2 bg-green-500 text-white rounded-full hover:bg-green-600 transition-colors"
              aria-label="Download clip"
            >
              <DownloadIcon />
            </a>
          </div>
        </div>
      ))}
    </div>
  </div>
);

export default App;